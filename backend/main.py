import os
import httpx
import logging
import time
import json
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from collections import defaultdict
from copy import deepcopy

# --- Constants ---
COMPOSITE_AGENTS_FILE = "composite_agents.json"

# --- Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Environment & App Setup ---
load_dotenv()
A2A_REGISTRY_URL = os.getenv("A2A_REGISTRY_URL", "http://localhost:8104/a2a")
logger.info(f"📡 Loaded A2A_REGISTRY_URL = {A2A_REGISTRY_URL}")

app = FastAPI(title="LowCode Backend")

# --- CORS ---
origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Models (DEFINED BEFORE USAGE) ---

# Represents the 'data' part of a ReactFlow node
class WorkflowNodeData(BaseModel):
    label: str
    agent: str
    method: str

# Represents a node in the ReactFlow graph
class WorkflowNode(BaseModel):
    id: str
    type: Optional[str] = None
    position: Optional[Dict[str, float]] = None
    data: WorkflowNodeData

# Represents an edge in the ReactFlow graph
class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    type: Optional[str] = None

# Request body for running the workflow
class WorkflowExecutionRequest(BaseModel):
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]
    initial_inputs: Dict[str, Any] = {}

# Log entry for a single step in the workflow execution
class ExecutionLog(BaseModel):
    nodeId: str
    agent: str
    method: str
    status: str # 'success', 'error', 'partial_success'
    inputs_used: Dict[str, Any]
    output: Any
    duration_ms: Optional[float] = None
    details: Optional[List[Dict[str, Any]]] = None

# Response body after running the workflow
class WorkflowExecutionResponse(BaseModel):
    status: str # 'completed', 'failed', 'partial_success'
    logs: List[ExecutionLog]
    final_state: Dict[str, Any]

# --- Models for Composite Agents ---
# Structure of a saved composite agent definition
class CompositeAgentDefinition(BaseModel):
    name: str
    description: str = ""
    method_name: str = "run"
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]

# Request body for registering a composite agent
class RegisterCompositeRequest(BaseModel):
    name: str = Field(..., min_length=1)
    description: str = ""
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]

# Structure representing an agent card (can be base or composite)
class AgentCard(BaseModel):
    name: str
    description: str = ""
    url: Optional[str] = None
    url_ext: Optional[str] = None
    methods: List[Dict[str, Any]]
    is_composite: bool = False
    composite_definition: Optional[CompositeAgentDefinition] = None


# --- File Handling Lock ---
file_lock = asyncio.Lock()

# --- Custom Exception ---
class AgentError(Exception):
    def __init__(self, detail: Any, node_id: str, call_id: Optional[str] = None):
        self.detail = detail
        self.node_id = node_id
        self.call_id = call_id
        log_prefix = f"Node '{node_id}'{f' (Call {call_id})' if call_id else ''}"
        super().__init__(f"Agent error in {log_prefix}: {detail}")

# --- Helper Functions ---

async def load_composite_agents() -> Dict[str, CompositeAgentDefinition]:
    """Loads composite agent definitions from the JSON file."""
    async with file_lock:
        if not os.path.exists(COMPOSITE_AGENTS_FILE):
            return {}
        try:
            with open(COMPOSITE_AGENTS_FILE, 'r') as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    logger.error(f"Invalid format in {COMPOSITE_AGENTS_FILE}, expected dict.")
                    return {}
                composites = {}
                for name, definition_dict in data.items():
                    try:
                        composites[name] = CompositeAgentDefinition(**definition_dict)
                    except Exception as e:
                        logger.error(f"Failed to parse composite agent '{name}': {e}")
                return composites
        except json.JSONDecodeError:
            logger.error(f"Error decoding JSON from {COMPOSITE_AGENTS_FILE}.")
            return {}
        except Exception as e:
            logger.exception(f"Error loading composite agents file: {e}")
            return {}

async def save_composite_agents(composites: Dict[str, CompositeAgentDefinition]):
    """Saves composite agent definitions to the JSON file."""
    async with file_lock:
        try:
            data_to_save = {name: definition.model_dump() for name, definition in composites.items()}
            with open(COMPOSITE_AGENTS_FILE, 'w') as f:
                json.dump(data_to_save, f, indent=4)
        except Exception as e:
            logger.exception(f"Error saving composite agents file: {e}")
            raise HTTPException(status_code=500, detail="Failed to save composite agents file.")

async def a2a_call(agent_url: str, method: str, params: dict, node_id: str, call_id: Optional[str] = None) -> Any:
    """Makes a JSON-RPC 2.0 call to an agent."""
    rpc_id = call_id or node_id
    payload = { "jsonrpc": "2.0", "method": method, "params": params, "id": rpc_id }
    timeout = 15.0
    log_prefix = f"📞 Node '{node_id}'{f' (Call {call_id})' if call_id else ''}:"
    logger.info(f"{log_prefix} Calling {method} on {agent_url} with params: {params}")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(agent_url, json=payload, timeout=timeout)
            # (Rest of a2a_call implementation remains the same)
            if resp.status_code != 200:
                 logger.error(f"❌{log_prefix} Received HTTP {resp.status_code} from {agent_url}. Response: {resp.text[:500]}")
                 try: error_detail = resp.json()
                 except Exception: error_detail = resp.text[:500]
                 raise HTTPException(status_code=resp.status_code, detail=f"Agent '{agent_url}' returned HTTP {resp.status_code}: {error_detail}")

            data = resp.json()
            if "error" in data:
                logger.error(f"❌{log_prefix} Received A2A Error: {data['error']}")
                raise AgentError(detail=data['error'], node_id=node_id, call_id=call_id)
            result = data.get("result")
            logger.info(f"✅{log_prefix} Received Result: {result}")
            return result
    except httpx.TimeoutException as e:
        logger.exception(f"⏰{log_prefix} A2A call to {agent_url} timed out.")
        raise AgentError(detail={"message": "Request timed out", "code": -32000}, node_id=node_id, call_id=call_id) from e
    except httpx.RequestError as e:
        logger.exception(f"💥{log_prefix} Failed to connect to {agent_url}. Error: {e}")
        raise HTTPException(status_code=503, detail=f"Service Unavailable: Could not connect to agent at {agent_url}. Reason: {str(e)}")
    except (AgentError, HTTPException) as e:
        raise e
    except Exception as e:
        logger.exception(f"🔥{log_prefix} Unexpected error during A2A call to {agent_url}. Error: {e}")
        raise AgentError(detail={"message": f"Unexpected client error: {str(e)}", "code": -32001}, node_id=node_id, call_id=call_id) from e


async def _get_base_agents_from_registry() -> List[Dict]:
    """Fetches only the base agents from the A2A registry."""
    # (Implementation remains the same)
    reg_payload = {"jsonrpc": "2.0", "method": "list_agents", "params": {}, "id": "list_base_agents"}
    try:
        async with httpx.AsyncClient() as client:
            reg_resp = await client.post(A2A_REGISTRY_URL, json=reg_payload, timeout=10.0)
            reg_resp.raise_for_status()
            reg_data = reg_resp.json()
            if "error" in reg_data: logger.error(f"❌ Registry error listing base agents: {reg_data['error']}"); return []
            return reg_data.get("result", [])
    except Exception as e:
        logger.exception(f"💥 Failed to reach or query registry at {A2A_REGISTRY_URL} for base agents: {e}")
        return []


async def _get_agent_details(agent_name: str, all_agents: List[AgentCard]) -> Optional[AgentCard]:
    """Finds agent details (base or composite) from the combined list."""
    for agent_card in all_agents:
        if agent_card.name == agent_name:
            return agent_card
    return None

def topological_sort(nodes: List[WorkflowNode], edges: List[WorkflowEdge]) -> List[str]:
    """Performs topological sort on the graph nodes. Returns ordered list of node IDs."""
    # (Implementation remains the same)
    in_degree = {node.id: 0 for node in nodes}
    successors = defaultdict(list)
    node_map = {node.id: node for node in nodes}
    for edge in edges:
        if edge.source in node_map and edge.target in node_map:
            successors[edge.source].append(edge.target); in_degree[edge.target] += 1
        else: logger.warning(f"⚠️ Edge connects unknown node(s): {edge.source} -> {edge.target}. Ignoring edge.")
    queue = [node_id for node_id in in_degree if in_degree[node_id] == 0]
    sorted_order = []
    while queue:
        u = queue.pop(0); sorted_order.append(u)
        for v in successors[u]:
            in_degree[v] -= 1
            if in_degree[v] == 0: queue.append(v)
    if len(sorted_order) != len(nodes):
        logger.error(f"❌ Cycle detected. Sorted: {len(sorted_order)}, Nodes: {len(nodes)}")
        cycle_nodes = [node_id for node_id, degree in in_degree.items() if degree > 0]
        raise HTTPException(status_code=400, detail=f"Workflow graph contains a cycle. Affected nodes: {cycle_nodes}")
    logger.info(f"✅ Topological Sort Order: {sorted_order}")
    return sorted_order

# --- Main Workflow Execution Logic (Now defined *after* Models) ---
async def execute_workflow_graph(
    nodes: List[WorkflowNode],
    edges: List[WorkflowEdge],
    initial_inputs: Dict[str, Any],
    all_agents_cache: List[AgentCard] # Pass preloaded agent list
) -> WorkflowExecutionResponse:
    """Executes a workflow graph, handling base and composite agents."""
    node_map = {node.id: node for node in nodes}
    # Type hint for logs uses ExecutionLog which is now defined above
    logs: List[ExecutionLog] = []
    global_state: Dict[str, Any] = initial_inputs.copy()
    workflow_status = "completed"

    try:
        execution_order = topological_sort(nodes, edges)
        if not execution_order and nodes:
             raise HTTPException(status_code=400, detail="Cannot determine workflow start node.")
        # Return type WorkflowExecutionResponse is now defined above
        elif not execution_order:
             return WorkflowExecutionResponse(status="completed", logs=[], final_state={})

        logger.info(f" Executing workflow steps: {execution_order}")

        for node_id in execution_order:
            node = node_map[node_id]
            agent_name = node.data.agent
            method_name = node.data.method
            # Instantiation uses ExecutionLog which is now defined above
            log_entry = ExecutionLog(nodeId=node_id, agent=agent_name, method=method_name, status="pending", inputs_used={}, output=None)
            node_start_time = time.monotonic()

            try:
                agent_card = await _get_agent_details(agent_name, all_agents_cache)
                if not agent_card:
                     raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found during execution.")

                # --- Check if it's a Composite Agent ---
                if agent_card.is_composite and agent_card.composite_definition:
                    # (Implementation for composite execution remains the same)
                    logger.info(f" Node '{node_id}' is a composite agent '{agent_name}'. Executing sub-workflow...")
                    composite_def = agent_card.composite_definition
                    log_entry.inputs_used = global_state.copy()
                    sub_response = await execute_workflow_graph(
                        nodes=composite_def.nodes, edges=composite_def.edges,
                        initial_inputs=deepcopy(global_state), all_agents_cache=all_agents_cache
                    )
                    global_state.update(sub_response.final_state)
                    log_entry.status = sub_response.status; log_entry.output = {"message": f"Composite execution finished with status: {sub_response.status}"}; log_entry.details = sub_response.logs
                    if sub_response.status != "completed":
                        workflow_status = sub_response.status
                        if workflow_status == "failed":
                            node_end_time = time.monotonic(); log_entry.duration_ms = (node_end_time - node_start_time) * 1000; logs.append(log_entry)
                            return WorkflowExecutionResponse(status=workflow_status, logs=logs, final_state=global_state)

                # --- Handle Base (A2A Callable) Agents ---
                else:
                     # (Implementation for base agent execution remains the same, including special dbservice handling)
                    agent_url = agent_card.url_ext or agent_card.url
                    if not agent_url: raise HTTPException(status_code=500, detail=f"No valid URL for base agent '{agent_name}'")

                    # --- Special Handling for dbservice_agent.create_record ---
                    if agent_name == 'dbservice_agent' and method_name == 'create_record':
                        # (...)
                        logger.info(f" Special handling for {agent_name}.{method_name}")
                        candidate_list_key = "$result"
                        candidates_to_save = global_state.get(candidate_list_key)
                        if not isinstance(candidates_to_save, list): raise AgentError(detail={"message": f"Input error: Expected list under key '{candidate_list_key}'"}, node_id=node_id)
                        if not candidates_to_save: log_entry.status = "success"; log_entry.output = {"message": "No candidates to save."}; log_entry.inputs_used = {"source_key": candidate_list_key}; log_entry.details = []
                        else:
                            individual_results = []; success_count = 0; error_count = 0
                            for index, candidate in enumerate(candidates_to_save):
                                call_id = f"{node_id}-item-{index}"; item_result = {"input_candidate": candidate, "status": "pending", "output": None}
                                try:
                                    if not isinstance(candidate, dict): raise ValueError("Candidate item is not a dict.")
                                    name = candidate.get("name"); title = candidate.get("title"); skills = candidate.get("skills")
                                    if not name or not title or skills is None: missing = [f"'{f}'" for f in ['name', 'title', 'skills'] if not candidate.get(f)]; raise ValueError(f"Missing fields: {', '.join(missing)}")
                                    if not isinstance(skills, list): raise ValueError(f"Expected 'skills' list, got {type(skills)}")
                                    params_for_candidate = {"name": name, "title": title, "skills": skills}
                                    save_output = await a2a_call(agent_url, method_name, params_for_candidate, node_id, call_id)
                                    item_result["status"] = "success"; item_result["output"] = save_output; success_count += 1
                                except (ValueError, AgentError, HTTPException) as item_err:
                                    error_count += 1; item_result["status"] = "error"
                                    if isinstance(item_err, ValueError): item_result["output"] = {"error": {"message": str(item_err), "code": -32602}}
                                    elif isinstance(item_err, AgentError): item_result["output"] = {"error": item_err.detail}
                                    elif isinstance(item_err, HTTPException): item_result["output"] = {"error": {"message": item_err.detail, "code": item_err.status_code}}
                                individual_results.append(item_result)
                            log_entry.details = individual_results; log_entry.status = "error" if error_count > 0 and success_count == 0 else "partial_success" if error_count > 0 else "success"; log_entry.output = {"message": f"Attempted {len(candidates_to_save)} saves.", "saved": success_count, "errors": error_count}; log_entry.inputs_used = {"source_key": candidate_list_key, "count": len(candidates_to_save)}; global_state[f"{node_id}_summary"] = log_entry.output
                            if error_count > 0: workflow_status = "failed" if success_count == 0 else "partial_success"
                    # --- Default Handling ---
                    else:
                        expected_params = [];
                        for m in agent_card.methods:
                             if m.get("name") == method_name: expected_params = [p.get("name") for p in m.get("params", []) if p.get("name")]; break
                        params_to_send = {k: v for k, v in global_state.items() if k in expected_params}
                        log_entry.inputs_used = params_to_send
                        output = await a2a_call(agent_url, method_name, params_to_send, node_id)
                        if isinstance(output, dict): global_state.update(output)
                        elif output is not None:
                            result_key = "$result";
                            for m in agent_card.methods:
                                if m.get("name") == method_name: returns = m.get("returns", []);
                                if len(returns) == 1 and returns[0].get("name"): result_key = returns[0]["name"]; break
                            global_state[result_key] = output
                        log_entry.status = "success"; log_entry.output = output

            # --- Error Handling for the node ---
            except (HTTPException, AgentError) as e:
                 # (...) Node error handling remains the same
                workflow_status = "failed"; log_entry.status = "error"; error_detail = {}
                if isinstance(e, AgentError): error_detail = {"error": e.detail}; logger.error(f"WF failed at Node '{node_id}' due to agent error: {e.detail}")
                elif isinstance(e, HTTPException): error_detail = {"error": {"message": e.detail, "code": e.status_code}}; logger.error(f"WF failed at Node '{node_id}' due to HTTP error: {e.status_code} - {e.detail}")
                log_entry.output = error_detail; node_end_time = time.monotonic(); log_entry.duration_ms = (node_end_time - node_start_time) * 1000; logs.append(log_entry)
                return WorkflowExecutionResponse(status=workflow_status, logs=logs, final_state=global_state)

            except Exception as e:
                 # (...) Unexpected node error handling remains the same
                 workflow_status = "failed"; log_entry.status = "error"; error_detail_msg = f"Unexpected internal error processing node: {str(e)}"; log_entry.output = {"error": {"message": error_detail_msg, "code": -32002}}
                 logger.exception(f"🔥 Workflow failed at Node '{node_id}' due to unexpected error: {e}"); node_end_time = time.monotonic(); log_entry.duration_ms = (node_end_time - node_start_time) * 1000; logs.append(log_entry)
                 raise HTTPException(status_code=500, detail=error_detail_msg) from e

            # --- Finalize Log Entry ---
            node_end_time = time.monotonic()
            log_entry.duration_ms = (node_end_time - node_start_time) * 1000
            logs.append(log_entry)

        logger.info(f" Workflow execution finished with status: {workflow_status}")
        # Return type WorkflowExecutionResponse is now defined above
        return WorkflowExecutionResponse(status=workflow_status, logs=logs, final_state=global_state)

    except HTTPException as e: raise e
    except Exception as e:
        logger.exception(f"🔥 Unexpected internal error during workflow orchestration: {e}")
        raise HTTPException(status_code=500, detail=f"Internal orchestration error: {str(e)}")


# --- Agent Cache ---
ALL_AGENTS_CACHE: List[AgentCard] = []

# --- API Endpoints (Defined *after* Models and Functions) ---

@app.on_event("startup")
async def startup_event():
    """Load agents on startup."""
    logger.info("Loading initial agent definitions...")
    await refresh_agent_cache()
    logger.info(f"Loaded {len(ALL_AGENTS_CACHE)} agents initially.")

async def refresh_agent_cache():
    """Helper to reload both base and composite agents."""
    global ALL_AGENTS_CACHE
    # (Implementation remains the same)
    base_agents_dict = await _get_base_agents_from_registry()
    composite_agents_dict = await load_composite_agents()
    combined_agents = []
    for agent_data in base_agents_dict:
        try:
             methods = agent_data.get("methods") or []
             if methods and isinstance(methods[0], str): methods = [{"name": m} for m in methods]
             combined_agents.append(AgentCard(name=agent_data["name"], description=agent_data.get("description", ""), url=agent_data.get("url"), url_ext=agent_data.get("url_ext"), methods=methods, is_composite=False))
        except Exception as e: logger.error(f"Failed to process base agent card '{agent_data.get('name')}': {e}")
    for name, definition in composite_agents_dict.items():
         combined_agents.append(AgentCard(name=name, description=definition.description, methods=[{"name": definition.method_name, "description": "Runs the composite workflow"}], is_composite=True, composite_definition=definition))
    ALL_AGENTS_CACHE = combined_agents
    logger.info(f"Refreshed agent cache. Total agents: {len(ALL_AGENTS_CACHE)}")


@app.get("/api/agents", response_model=List[Dict[str, Any]])
async def get_agents():
    """Returns a merged list of base and composite agents."""
    # (Implementation remains the same)
    logger.info(" Rcvd /api/agents request")
    response_list = []
    for agent in ALL_AGENTS_CACHE:
         agent_dict = agent.model_dump(exclude={'composite_definition'})
         response_list.append(agent_dict)
    logger.info(f" Returning {len(response_list)} agents (base + composite)")
    return response_list


@app.post("/api/register_composite", status_code=201)
async def register_composite(req: RegisterCompositeRequest):
    """Saves a new composite agent definition."""
    # (Implementation remains the same)
    logger.info(f" Rcvd /api/register_composite request for '{req.name}'")
    if not req.nodes: raise HTTPException(status_code=400, detail="Composite workflow must contain at least one node.")
    composites = await load_composite_agents()
    existing_names = set(composites.keys()).union({agent.name for agent in ALL_AGENTS_CACHE if not agent.is_composite})
    if req.name in existing_names: raise HTTPException(status_code=409, detail=f"Agent name '{req.name}' already exists.")
    new_definition = CompositeAgentDefinition(name=req.name, description=req.description, nodes=req.nodes, edges=req.edges)
    composites[req.name] = new_definition
    await save_composite_agents(composites)
    await refresh_agent_cache()
    logger.info(f" Successfully registered composite agent '{req.name}'")
    return {"message": f"Composite agent '{req.name}' registered successfully."}


@app.post("/api/run_workflow", response_model=WorkflowExecutionResponse)
async def run_workflow_endpoint(req: WorkflowExecutionRequest):
     """API endpoint to trigger workflow execution."""
     # (Implementation remains the same)
     logger.info(f" Rcvd /api/run_workflow request via endpoint. Nodes: {len(req.nodes)}, Edges: {len(req.edges)}")
     return await execute_workflow_graph(
         nodes=req.nodes, edges=req.edges, initial_inputs=req.initial_inputs, all_agents_cache=ALL_AGENTS_CACHE
     )

@app.get("/health")
async def health():
    """Basic health check endpoint."""
    # (Implementation remains the same)
    return {"status": "ok", "service": "lowcode_backend"}