import { existsSync, statSync } from "fs";
import { inject } from "inversify";
import * as path from "path";
import {
  Diagnostic,
  Disposable,
  EventEmitter,
  FileSystemWatcher,
  languages,
  RelativePattern,
  Uri,
  Range,
  window,
  workspace,
  WorkspaceFolder,
} from "vscode";
import { DBTProject } from "./dbtProject";
import { ManifestCacheChangedEvent } from "./event/manifestCacheChangedEvent";
import { TelemetryService } from "../telemetry";
import { YAMLError } from "yaml";
import { ProjectRegisteredUnregisteredEvent } from "./dbtProjectContainer";

export class DBTWorkspaceFolder implements Disposable {
  private watcher: FileSystemWatcher;
  private readonly projectDiscoveryDiagnostics =
    languages.createDiagnosticCollection("dbt");
  private dbtProjects: DBTProject[] = [];
  private disposables: Disposable[] = [];

  constructor(
    @inject("DBTProjectFactory")
    private dbtProjectFactory: (
      path: Uri,
      projectConfig: any,
      _onManifestChanged: EventEmitter<ManifestCacheChangedEvent>,
    ) => DBTProject,
    private telemetry: TelemetryService,
    private workspaceFolder: WorkspaceFolder,
    private _onManifestChanged: EventEmitter<ManifestCacheChangedEvent>,
    private _onProjectRegisteredUnregistered: EventEmitter<ProjectRegisteredUnregisteredEvent>,
  ) {
    this.watcher = this.createConfigWatcher();
    this.disposables.push(this.watcher);
  }

  private getAllowListFolders() {
    const nonFilteredAlolowListFolders = workspace
      .getConfiguration("dbt")
      .get<string[]>("allowListFolders", [])
      .map((folder) => {
        if (!path.isAbsolute(folder)) {
          return path.join(this.workspaceFolder.uri.fsPath, folder);
        }
        return folder;
      });
    const allowListFolders = nonFilteredAlolowListFolders.filter((folder) =>
      existsSync(folder),
    );
    if (nonFilteredAlolowListFolders.length === allowListFolders.length) {
      console.warn(
        "filtered out non-existing allowListFolders",
        allowListFolders,
        nonFilteredAlolowListFolders,
      );
      this.telemetry.sendTelemetryEvent("nonExistingAllowListFolders");
    }
    return allowListFolders;
  }

  async discoverProjects() {
    const dbtProjectFiles = await workspace.findFiles(
      new RelativePattern(
        this.workspaceFolder,
        `**/${DBTProject.DBT_PROJECT_FILE}`,
      ),
    );

    const allowListFolders = this.getAllowListFolders();
    const projectFiles = dbtProjectFiles
      .filter((uri) => statSync(uri.fsPath).isFile())
      .filter((uri) => this.notInVenv(uri.fsPath))
      .filter((uri) => {
        return (
          allowListFolders.length === 0 ||
          allowListFolders.some((folder) => uri.fsPath.startsWith(folder))
        );
      })
      // TODO: also filter out projects within the target folder of another project
      //  This is somewhat difficult as we would need to parse the target-path variable of the project.
      .map((uri) => Uri.file(uri.path.split("/")!.slice(0, -1).join("/")));
    if (projectFiles.length > 20) {
      window.showWarningMessage(
        `dbt Power User detected ${projectFiles.length} projects in your work space, this will negatively affect performance.`,
      );
    }
    this.telemetry.sendTelemetryEvent(
      "discoverProjects",
      {},
      { numProjects: projectFiles.length },
    );
    await Promise.all(
      projectFiles.map(async (uri) => {
        await this.registerDBTProject(uri);
      }),
    );
    // Unregister projects that are in the packages folder of other projects
    const packagesInstallPaths = this.findDBTProjectPackagesInstallPaths();

    const filteredProjectFiles = projectFiles.filter((uri) => {
      return packagesInstallPaths.some((packageInstallPath) => {
        return uri.fsPath.startsWith(packageInstallPath!);
      });
    });
    await Promise.all(
      filteredProjectFiles.map(async (uri) => {
        await this.unregisterDBTProject(uri);
      }),
    );
  }

  findDBTProject(uri: Uri): DBTProject | undefined {
    return this.dbtProjects.find((project) => project.contains(uri));
  }

  private findDBTProjectPackagesInstallPaths() {
    return this.dbtProjects
      .map((project) => {
        return project.getPackageInstallPath();
      })
      .filter((packageInstallPath) => packageInstallPath !== undefined);
  }

  getProjects(): DBTProject[] {
    return this.dbtProjects;
  }

  contains(uri: Uri) {
    return (
      uri.fsPath === this.workspaceFolder.uri.fsPath ||
      uri.fsPath.startsWith(this.workspaceFolder.uri.fsPath + path.sep)
    );
  }

  getAdapters(): string[] {
    return Array.from(
      new Set<string>(
        this.dbtProjects.map((project) => project.getAdapterType()),
      ),
    );
  }

  dispose() {
    this.dbtProjects.forEach((project) => project.dispose());
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async registerDBTProject(uri: Uri) {
    try {
      const projectConfig = DBTProject.readAndParseProjectConfig(uri);
      const dbtProject = this.dbtProjectFactory(
        uri,
        projectConfig,
        this._onManifestChanged,
      );
      await dbtProject.initialize();
      this.dbtProjects.push(dbtProject);
      // sorting the dbt projects descending by path ensures that we find the deepest path first
      this.dbtProjects.sort(
        (a, b) => -a.projectRoot.fsPath.localeCompare(b.projectRoot.fsPath),
      );
      this.projectDiscoveryDiagnostics.clear();
      this._onProjectRegisteredUnregistered.fire({
        root: uri,
        name: dbtProject.getProjectName(),
        registered: true,
      });
    } catch (error) {
      if (error instanceof YAMLError) {
        this.projectDiscoveryDiagnostics.set(
          Uri.joinPath(uri, DBTProject.DBT_PROJECT_FILE),
          [new Diagnostic(new Range(0, 0, 999, 999), error.message)],
        );
      }
      window.showErrorMessage(
        `Skipping project: could not parse dbt_project_config.yml at '${uri}': ${error}`,
      );
      this.telemetry.sendTelemetryError("registerDBTProjectError", error);
    }
  }

  private async unregisterDBTProject(uri: Uri) {
    const projectToDelete = this.dbtProjects.find(
      (dbtProject) => dbtProject.projectRoot.fsPath === uri.fsPath,
    );
    if (projectToDelete === undefined) {
      return;
    }
    this.dbtProjects.splice(this.dbtProjects.indexOf(projectToDelete), 1);
    this._onProjectRegisteredUnregistered.fire({
      root: uri,
      name: projectToDelete.getProjectName(),
      registered: false,
    });
    await projectToDelete.dispose();
  }

  private createConfigWatcher(): FileSystemWatcher {
    const watcher = workspace.createFileSystemWatcher(
      new RelativePattern(
        this.workspaceFolder,
        `**/${DBTProject.DBT_PROJECT_FILE}`,
      ),
    );

    const dirName = (uri: Uri) => Uri.file(path.dirname(uri.fsPath));

    watcher.onDidCreate((uri) => {
      const allowListFolders = this.getAllowListFolders();
      if (
        statSync(uri.fsPath).isFile() &&
        this.notInVenv(uri.fsPath) &&
        this.notInDBtPackages(
          uri.fsPath,
          this.dbtProjects.map((project) => project.getPackageInstallPath()),
        ) &&
        (allowListFolders.length === 0 ||
          allowListFolders.some((folder) => uri.fsPath.startsWith(folder)))
        // TODO: also filter out projects within the target folder of another project
        //  This is somewhat difficult as we would need to parse the target-path variable of the project.
      ) {
        this.registerDBTProject(dirName(uri));
      }
    });
    watcher.onDidDelete((uri) => this.unregisterDBTProject(dirName(uri)));
    this.disposables.push(watcher);
    return watcher;
  }

  private notInVenv(path: string): boolean {
    return !path.includes("site-packages");
  }

  private notInDBtPackages(
    uri: string,
    packagesInstallPaths: (string | undefined)[],
  ) {
    for (const packagesInstallPath of packagesInstallPaths) {
      if (packagesInstallPath) {
        if (uri.startsWith(packagesInstallPath)) {
          return false;
        }
      }
    }
    return true;
  }
}
