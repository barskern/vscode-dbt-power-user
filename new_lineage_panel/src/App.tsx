import {
  Dispatch,
  FunctionComponent,
  SetStateAction,
  createContext,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  NodeTypes,
  ReactFlowInstance,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  ColumnNode,
  SeeMoreNode,
  SelfConnectingEdge,
  TableNode,
} from "./CustomNodes";
import { SidebarModal } from "./SidebarModal";
import { MoreTables, TMoreTables } from "./MoreTables";
import { Table } from "./service";
import { expandTableLineage, layoutElementsOnCanvas } from "./graph";
import { TableDetails } from "./TableDetails";
import { Button, Card, CardBody, Input, Label, Tooltip } from "reactstrap";
import AlertCircleIcon from "./assets/icons/alert-circle.svg?react";
import styles from "./styles.module.scss";
import { TABLES_SIDEBAR, COLUMNS_SIDEBAR, EXPOSURE_SIDEBAR } from "./constants";
import ExposureDetails from "./exposure/ExposureDetails";

declare const acquireVsCodeApi: () => { postMessage: (v: unknown) => void };

const vscode = acquireVsCodeApi();

export let aiEnabled = false;
let id = 0;
const requestMap: Record<
  number,
  { resolve: (k: unknown) => void; reject: (reason?: string) => void }
> = {};
export const requestExecutor = (url: string, params: unknown) => {
  return new Promise((resolve, reject) => {
    requestMap[id] = { resolve, reject };
    vscode.postMessage({ command: url, args: { id, params } });
    id++;
  });
};
export const openFile = (url: string) => {
  vscode.postMessage({ command: "openFile", args: { url } });
};
export const openDocs = () => {
  vscode.postMessage({
    command: "openDocs",
    args: {
      url: aiEnabled
        ? "https://docs.google.com/forms/d/e/1FAIpQLScsvmEdZ56F1GAFZq_SW7ejYe0dwpHe-N69qiQBz4ekN4gPNQ/viewform"
        : "https://docs.google.com/forms/d/10_YT2XDwpbkDXio-7TEYPQXsJfCBFqYUa7t0ImzyZvE/viewform",
    },
  });
};
export const startProgressBar = () => {
  vscode.postMessage({ command: "startProgressBar", args: {} });
};
export const endProgressBar = () => {
  vscode.postMessage({ command: "endProgressBar", args: {} });
};
export const previewFeature = () => {
  vscode.postMessage({ command: "previewFeature", args: {} });
};

export let isDarkMode = false;

const nodeTypes: NodeTypes = {
  table: TableNode,
  seeMore: SeeMoreNode,
  column: ColumnNode,
};
const edgeTypes = { selfConnecting: SelfConnectingEdge };

export const LineageContext = createContext<{
  showSidebar: boolean;
  setShowSidebar: Dispatch<boolean>;
  selectedTable: Table | null;
  setSelectedTable: Dispatch<SetStateAction<Table | null>>;
  moreTables: TMoreTables;
  setMoreTables: Dispatch<SetStateAction<TMoreTables>>;
  sidebarScreen: string;
  setSidebarScreen: Dispatch<string>;
  selectedColumn: { name: string; table: string };
  setSelectedColumn: Dispatch<SetStateAction<{ name: string; table: string }>>;
  collectColumns: Record<string, string[]>;
  setCollectColumns: Dispatch<SetStateAction<Record<string, string[]>>>;
  rerender: () => void;
  setConfidence: Dispatch<
    SetStateAction<{ confidence: string; operator_list?: string[] }>
  >;
}>({
  showSidebar: false,
  setShowSidebar: () => {},
  selectedTable: null,
  setSelectedTable: () => null,
  moreTables: {},
  setMoreTables: () => {},
  sidebarScreen: "",
  setSidebarScreen: () => {},
  selectedColumn: { name: "", table: "" },
  setSelectedColumn: () => "",
  collectColumns: {},
  setCollectColumns: () => {},
  rerender: () => {},
  setConfidence: () => {},
});

const InfoIcon: FunctionComponent<{ id: string; message: string }> = ({
  id,
  message,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div
      className={styles.alert_icon}
      id={id}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <AlertCircleIcon />
      <Tooltip target={id} isOpen={isOpen}>
        {message}
      </Tooltip>
    </div>
  );
};

function App() {
  const flow = useRef<ReactFlowInstance<unknown, unknown>>();
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [moreTables, setMoreTables] = useState<TMoreTables>({});
  const [sidebarScreen, setSidebarScreen] = useState("");
  const [selectedColumn, setSelectedColumn] = useState({ name: "", table: "" });
  const [collectColumns, setCollectColumns] = useState<
    Record<string, string[]>
  >({});
  const [confidence, setConfidence] = useState<{
    confidence: string;
    operator_list?: string[];
  }>({ confidence: "high" });
  const [, _rerender] = useState(0);
  const rerender = () => _rerender((x) => (x + 1) % 100);

  const [selectCheck, setSelectCheck] = useState(false);
  const [nonSelectCheck, setNonSelectCheck] = useState(false);

  useEffect(() => {
    const render = async (args: {
      node: {
        table: string;
        label: string;
        url: string;
        nodeType: string;
        materialization?: string;
        downstreamCount: number;
        upstreamCount: number;
        tests: { key: string; path: string }[];
      };
      aiEnabled: boolean;
    }) => {
      setShowSidebar(false);
      if (!args) {
        return;
      }
      const { node, aiEnabled: _aiEnabled } = args;
      aiEnabled = _aiEnabled;
      const _flow = flow.current;
      if (!_flow) {
        return;
      }
      const existingNode = _flow.getNode(node.table);
      let nodes: Node[] = [];
      let edges: Edge[] = [];
      const addNodesEdges = async (table: string, right: boolean) => {
        [nodes, edges] = await expandTableLineage(nodes, edges, table, right);
        // TODO: on opening file, how to handle cll
        // if (selectedColumn.name) {
        //   startProgressBar()
        //   await bfsTraversal(
        //     nodes,
        //     edges,
        //     right,
        //     [selectedColumn],
        //     setConfidence,
        //     setMoreTables,
        //     setCollectColumns,
        //     _flow
        //   );
        //   endProgressBar()
        // } else if (selectedTable) {
        //   [nodes, edges] = highlightTableConnections(
        //     nodes,
        //     edges,
        //     selectedTable.table
        //   );
        // }
      };
      if (existingNode) {
        const { processed } = existingNode.data as {
          level: number;
          processed: [boolean, boolean];
        };
        nodes = _flow.getNodes();
        edges = _flow.getEdges();
        if (!processed[1]) await addNodesEdges(node.table, true);
        if (!processed[0]) await addNodesEdges(node.table, false);
      } else {
        nodes = [
          {
            id: node.table,
            data: {
              table: node.table,
              label: node.label,
              url: node.url,
              level: 0,
              shouldExpand: [node.downstreamCount > 0, node.upstreamCount > 0],
              processed: [node.downstreamCount > 0, node.upstreamCount > 0],
              nodeType: node.nodeType,
              upstreamCount: node.upstreamCount,
              downstreamCount: node.downstreamCount,
              tests: node.tests,
              materialization: node.materialization,
            },
            position: { x: 100, y: 100 },
            type: "table",
          },
        ];
        if (node.upstreamCount > 0) await addNodesEdges(node.table, true);
        if (node.downstreamCount > 0) await addNodesEdges(node.table, false);
        setSelectedTable(null);
        setSelectedColumn({ table: "", name: "" });
        setCollectColumns({});
        setMoreTables({});
      }

      layoutElementsOnCanvas(nodes, edges);
      _flow.setNodes(nodes);
      _flow.setEdges(edges);
      rerender();
    };
    const response = (args: {
      id: number;
      body: unknown;
      status: boolean;
      error: string;
    }) => {
      const { resolve, reject } = requestMap[args.id];
      if (args.status) {
        resolve(args.body);
      } else {
        reject(args.error);
      }
      delete requestMap[args.id];
    };
    const setTheme = ({ theme }: { theme: string }) => {
      isDarkMode = theme === "dark";
      document.documentElement.setAttribute("data-theme", theme);
      rerender();
    };
    const commandMap = { render, response, setTheme };
    window.addEventListener("message", (event) => {
      console.log("lineage:message -> ", event.data);
      const { command, args } = event.data;
      if ((command as string) in commandMap) {
        commandMap[command as keyof typeof commandMap](args);
      }
    });
    console.log("lineage:onload -> ");
    vscode.postMessage({ command: "init", args: {} });
  }, []);

  useEffect(() => {
    const _flow = flow.current;
    if (!_flow) return;
    const _edges = _flow.getEdges();
    if ((selectCheck && nonSelectCheck) || (!selectCheck && !nonSelectCheck)) {
      for (const e of _edges) e.hidden = false;
      _flow.setEdges(_edges);
      return;
    }
    for (const e of _edges) {
      e.hidden = false;
      const _type = (e.data as { type: string })?.type;
      if (!_type) continue;
      if (_type === "direct") e.hidden = !selectCheck;
      if (_type === "indirect") e.hidden = !nonSelectCheck;
    }
    _flow.setEdges(_edges);
  }, [selectCheck, nonSelectCheck]);

  return (
    <div className="position-relative">
      <div className="top-right-container">
        {aiEnabled && selectedColumn.name && (
          <Card className={styles.menu_card_container}>
            <CardBody className={styles.menu_card}>
              <div className="d-flex gap-sm">
                <div className={styles.select_node_checkbox}>
                  <Input
                    type="checkbox"
                    id="select-check"
                    className="mt-0"
                    checked={selectCheck}
                    onChange={(e) => setSelectCheck(e.target.checked)}
                  />
                  <Label check for="select-check">
                    Select
                  </Label>
                  <InfoIcon
                    id="select_lineage"
                    message="Select linkages are shown if there is direct flow of data between columns through select statements."
                  />
                </div>
                <div className={styles.non_select_node_checkbox}>
                  <Input
                    type="checkbox"
                    id="non-select-check"
                    className="mt-0"
                    checked={nonSelectCheck}
                    onChange={(e) => setNonSelectCheck(e.target.checked)}
                  />
                  <Label check for="non-select-check">
                    Non-Select
                  </Label>
                  <InfoIcon
                    id="non_select_lineage"
                    message="Non-Select linkages are shown if columns appear in condition/clauses like where, join, having, etc."
                  />
                </div>
                {confidence.confidence === "low" && (
                  <>
                    <div className={styles.verticle_divider} />
                    <div className="d-flex gap-xxs align-items-center">
                      <div>Confidence</div>
                      {confidence.operator_list && (
                        <InfoIcon
                          id="confidence"
                          message={`The confidence of lineage for indirect links is low because of the presence of the following in the sql: ${Array.from(
                            new Set(confidence.operator_list)
                          ).join(", ")}`}
                        />
                      )}
                      <div className={styles.low_confidence}>Low</div>
                    </div>
                  </>
                )}
              </div>
            </CardBody>
          </Card>
        )}
        <Button
          size="sm"
          color="secondary"
          onClick={(e) => {
            e.stopPropagation();
            flow.current?.setNodes([]);
            flow.current?.setEdges([]);
            setSelectedTable(null);
            setSelectedColumn({ table: "", name: "" });
            setCollectColumns({});
            setMoreTables({});
            vscode.postMessage({ command: "init" });
          }}
          data-testid="reset-btn"
        >
          Reset
        </Button>
        <Button
          size="sm"
          color="primary"
          onClick={(e) => {
            e.stopPropagation();
            vscode.postMessage({ command: "setLegacyLineageView" });
          }}
        >
          Show Legacy UX
        </Button>
        <Button
          size="sm"
          color="link"
          onClick={(e) => {
            e.stopPropagation();
            openDocs();
          }}
        >
          Feedback
        </Button>
      </div>
      <LineageContext.Provider
        value={{
          showSidebar,
          setShowSidebar,
          selectedTable,
          setSelectedTable,
          moreTables,
          setMoreTables,
          sidebarScreen,
          setSidebarScreen,
          selectedColumn,
          setSelectedColumn,
          collectColumns,
          setCollectColumns,
          rerender,
          setConfidence,
        }}
      >
        <ReactFlowProvider>
          <div style={{ height: "100vh", width: "100vw" }}>
            <ReactFlow
              defaultNodes={[]}
              defaultEdges={[]}
              onInit={(_flow) => (flow.current = _flow)}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              style={{ background: "var(--bg-color)" }}
              proOptions={{ hideAttribution: true }}
              minZoom={0.1}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
          <SidebarModal
            isOpen={showSidebar}
            toggleModal={() => setShowSidebar((b) => !b)}
            width={446}
          >
            {sidebarScreen === TABLES_SIDEBAR && <MoreTables />}
            {sidebarScreen === COLUMNS_SIDEBAR && <TableDetails />}
            {sidebarScreen === EXPOSURE_SIDEBAR && <ExposureDetails />}
          </SidebarModal>
        </ReactFlowProvider>
      </LineageContext.Provider>
    </div>
  );
}

export default App;
