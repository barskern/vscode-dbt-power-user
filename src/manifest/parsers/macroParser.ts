import { readFileSync } from "fs";
import { provide } from "inversify-binding-decorators";
import { DBTTerminal } from "../../dbt_client/dbtTerminal";
import { MacroMetaMap } from "../../domain";
import { DBTProject } from "../dbtProject";
import { createFullPathForNode } from ".";

@provide(MacroParser)
export class MacroParser {
  constructor(private terminal: DBTTerminal) {}

  createMacroMetaMap(
    macros: any[],
    project: DBTProject,
  ): Promise<MacroMetaMap> {
    return new Promise(async (resolve) => {
      const macroMetaMap: MacroMetaMap = new Map();
      if (macros === null || macros === undefined) {
        resolve(macroMetaMap);
      }
      const rootPath = project.projectRoot.fsPath;
      // TODO: these things can change so we should recreate them if project config changes
      const projectName = project.getProjectName();
      const packagePath = project.getPackageInstallPath();
      if (packagePath === undefined) {
        throw new Error(
          "packagePath is not defined in " + project.projectRoot.fsPath,
        );
      }
      if (typeof macros[Symbol.iterator] !== "function") {
        resolve(macroMetaMap);
        return;
      }
      for (const macro of macros) {
        const { package_name, name, original_file_path } = macro;
        const packageName = package_name;
        const macroName =
          packageName === projectName ? name : `${packageName}.${name}`;
        const fullPath = createFullPathForNode(
          projectName,
          rootPath,
          packageName,
          packagePath,
          original_file_path,
        );
        if (!fullPath) {
          return;
        }
        try {
          const macroFile: string = readFileSync(fullPath).toString("utf8");
          const macroFileLines = macroFile.split("\n");

          for (let index = 0; index < macroFileLines.length; index++) {
            const currentLine = macroFileLines[index];
            if (currentLine.match(new RegExp(`macro\\s${name}\\(`))) {
              macroMetaMap.set(macroName, {
                path: fullPath,
                line: index,
                character: currentLine.indexOf(name),
              });
              break;
            }
          }
        } catch (error) {
          console.log(
            `File not found at '${fullPath}', project may need to be recompiled.`,
            error,
          );
          this.terminal.log(
            `File not found at '${fullPath}', probably compiled is outdated. ${error}`,
          );
        }
      }
      resolve(macroMetaMap);
    });
  }
}
