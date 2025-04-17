import os
import httpx
import logging
import time # Import the standard time module
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from collections import defaultdict

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()
A2A_REGISTRY_URL = os.getenv("A2A_REGISTRY_URL", "http://localhost:8104/a2a")
logger.info(f"📡 Loaded A2A_REGISTRY_URL = {A2A_REGISTRY_URL}")

app = FastAPI(title="LowCode Backend")

# --- CORS Configuration ---
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --- End CORS Configuration ---


# --- Pydantic Models ---
class WorkflowNodeData(BaseModel):
    label: str
    agent: str
    method: str

class WorkflowNode(BaseModel):
    id: str
    type: Optional[str] = None
    position: Optional[Dict[str, float]] = None
    data: WorkflowNodeData

class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    type: Optional[str] = None

class WorkflowExecutionRequest(BaseModel):
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]
    initial_inputs: Dict[str, Any] = {}

class ExecutionLog(BaseModel):
    nodeId: str
    agent: str
    method: str
    status: str # 'success', 'error', 'partial_success'
    inputs_used: Dict[str, Any] # For single calls, or summary for loops
    output: Any # Result from the agent, error message, or summary for loops
    duration_ms: Optional[float] = None
    # Optional field for detailed results when a node makes multiple calls
    details: Optional[List[Dict[str, Any]]] = None


class WorkflowExecutionResponse(BaseModel):
    status: str
    logs: List[ExecutionLog]
    final_state: Dict[str, Any]


# --- Helper Functions ---

async def a2a_call(agent_url: str, method: str, params: dict, node_id: str, call_id: Optional[str] = None) -> Any:
    """Makes a JSON-RPC 2.0 call to an agent."""
    rpc_id = call_id or node_id # Use specific call ID if provided (for loops)
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": rpc_id
    }
    timeout = 15.0
    log_prefix = f"📞 Node '{node_id}'{f' (Call {call_id})' if call_id else ''}:"
    logger.info(f"{log_prefix} Calling {method} on {agent_url} with params: {params}")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(agent_url, json=payload, timeout=timeout)
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

class AgentError(Exception):
    def __init__(self, detail: Any, node_id: str, call_id: Optional[str] = None):
        self.detail = detail
        self.node_id = node_id
        self.call_id = call_id
        log_prefix = f"Node '{node_id}'{f' (Call {call_id})' if call_id else ''}"
        super().__init__(f"Agent error in {log_prefix}: {detail}")


async def _get_agent_card(agent_name: str) -> dict:
    """Fetches agent metadata (card) from the A2A registry."""
    # (No changes needed in this function)
    payload = {
        "jsonrpc": "2.0",
        "method": "get_agent",
        "params": {"name": agent_name},
        "id": f"registry_lookup_{agent_name}"
    }
    logger.info(f"🔍 Looking up agent '{agent_name}' in registry: {A2A_REGISTRY_URL}")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(A2A_REGISTRY_URL, json=payload, timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                 logger.error(f"❌ Registry error looking up '{agent_name}': {data['error']}")
                 raise HTTPException(status_code=500, detail=f"Registry agent lookup error: {data['error']}")
            agent_card = data.get("result", {})
            if not agent_card:
                 logger.error(f"❓ Agent '{agent_name}' not found in registry.")
                 raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found in registry.")
            logger.info(f"✅ Found agent card for '{agent_name}'.")
            return agent_card
    except httpx.RequestError as e:
        logger.exception(f"💥 Failed to reach registry at {A2A_REGISTRY_URL}. Error: {e}")
        raise HTTPException(status_code=503, detail=f"Could not connect to A2A Registry at {A2A_REGISTRY_URL}. Reason: {str(e)}")
    except Exception as e:
        logger.exception(f"🔥 Unexpected error fetching agent card for '{agent_name}'. Error: {e}")
        raise HTTPException(status_code=500, detail=f"Internal error fetching agent card: {str(e)}")


def get_expected_params(agent_card: dict, method_name: str) -> List[str]:
    """Extracts the list of expected parameter names for a given method from the agent card."""
    # (No changes needed in this function)
    for method_info in agent_card.get("methods", []):
        if method_info.get("name") == method_name:
            return [param.get("name") for param in method_info.get("params", []) if param.get("name")]
    logger.warning(f"⚠️ Method '{method_name}' not found or has no params defined in agent card: {agent_card.get('name')}")
    return []


def topological_sort(nodes: List[WorkflowNode], edges: List[WorkflowEdge]) -> List[str]:
    """Performs topological sort on the graph nodes. Returns ordered list of node IDs."""
    # (No changes needed in this function)
    in_degree = {node.id: 0 for node in nodes}
    successors = defaultdict(list)
    node_map = {node.id: node for node in nodes}

    for edge in edges:
        if edge.source in node_map and edge.target in node_map:
            successors[edge.source].append(edge.target)
            in_degree[edge.target] += 1
        else:
             logger.warning(f"⚠️ Edge connects unknown node(s): {edge.source} -> {edge.target}. Ignoring edge.")

    queue = [node_id for node_id in in_degree if in_degree[node_id] == 0]
    sorted_order = []

    while queue:
        u = queue.pop(0)
        sorted_order.append(u)

        for v in successors[u]:
            in_degree[v] -= 1
            if in_degree[v] == 0:
                queue.append(v)

    if len(sorted_order) != len(nodes):
        logger.error(f"❌ Cycle detected in workflow graph. Sorted: {len(sorted_order)}, Nodes: {len(nodes)}")
        cycle_nodes = [node_id for node_id, degree in in_degree.items() if degree > 0]
        raise HTTPException(status_code=400, detail=f"Workflow graph contains a cycle. Affected nodes: {cycle_nodes}")

    logger.info(f"✅ Topological Sort Order: {sorted_order}")
    return sorted_order


# --- API Endpoints ---

@app.get("/api/agents", response_model=List[Dict[str, Any]])
async def get_agents():
    """Fetches the list of all registered agents from the A2A registry."""
    # (No changes needed in this function)
    logger.info(" Rcvd /api/agents request")
    reg_payload = {
        "jsonrpc": "2.0",
        "method": "list_agents",
        "params": {},
        "id": "list_all_agents_request"
    }
    try:
        async with httpx.AsyncClient() as client:
            reg_resp = await client.post(A2A_REGISTRY_URL, json=reg_payload, timeout=10.0)
            reg_resp.raise_for_status()
            reg_data = reg_resp.json()
            if "error" in reg_data:
                logger.error(f"❌ Registry error listing agents: {reg_data['error']}")
                raise HTTPException(status_code=500, detail=f"Registry error listing agents: {reg_data['error']}")
            agents_list = reg_data.get("result", [])
            logger.info(f" Returning {len(agents_list)} agents")
            return agents_list
    except httpx.RequestError as e:
        logger.exception(f"💥 Failed to reach registry at {A2A_REGISTRY_URL} for listing agents. Error: {e}")
        raise HTTPException(status_code=503, detail=f"Could not connect to A2A Registry at {A2A_REGISTRY_URL}. Reason: {str(e)}")
    except Exception as e:
        logger.exception(f"🔥 Unexpected error listing agents. Error: {e}")
        raise HTTPException(status_code=500, detail=f"Internal error listing agents: {str(e)}")


@app.post("/api/run_workflow", response_model=WorkflowExecutionResponse)
async def run_workflow(req: WorkflowExecutionRequest):
    """Executes a workflow defined by nodes and edges."""
    logger.info(f" Rcvd /api/run_workflow request. Nodes: {len(req.nodes)}, Edges: {len(req.edges)}")
    logger.debug(f" Initial Inputs: {req.initial_inputs}")
    # logger.debug(f" Nodes: {req.nodes}") # Can be verbose
    # logger.debug(f" Edges: {req.edges}") # Can be verbose

    if not req.nodes:
         raise HTTPException(status_code=400, detail="Workflow must contain at least one node.")

    node_map = {node.id: node for node in req.nodes}
    logs: List[ExecutionLog] = []
    global_state: Dict[str, Any] = req.initial_inputs.copy()
    workflow_status = "completed"

    try:
        execution_order = topological_sort(req.nodes, req.edges)
        if not execution_order and req.nodes:
             raise HTTPException(status_code=400, detail="Cannot determine workflow start node. Check graph structure.")
        elif not execution_order:
             return WorkflowExecutionResponse(status="completed", logs=[], final_state={})

        logger.info(f" Executing workflow steps: {execution_order}")

        for node_id in execution_order:
            node = node_map[node_id]
            agent_name = node.data.agent
            method_name = node.data.method
            log_entry = ExecutionLog( # Initialize log entry early
                nodeId=node_id,
                agent=agent_name,
                method=method_name,
                status="pending",
                inputs_used={},
                output=None
            )
            node_start_time = time.monotonic() # Use standard time

            try:
                # --- Get agent details ---
                agent_card = await _get_agent_card(agent_name)
                agent_url = agent_card.get("url_ext") or agent_card.get("url")
                if not agent_url:
                    raise HTTPException(status_code=500, detail=f"No valid URL found for agent '{agent_name}'")

                # --- Special Handling for dbservice_agent.create_record ---
                if agent_name == 'dbservice_agent' and method_name == 'create_record':
                    logger.info(f" Special handling for {agent_name}.{method_name}")
                    # Expecting a list of candidates, likely under '$result' from previous step
                    candidate_list_key = "$result" # Default key based on webservice_agent spec
                    candidates_to_save = global_state.get(candidate_list_key)

                    if not isinstance(candidates_to_save, list):
                         logger.error(f"❌ Node '{node_id}': Expected a list of candidates under key '{candidate_list_key}' in global state, but found type {type(candidates_to_save)}.")
                         raise AgentError(detail={"message": f"Input error: Expected a list under key '{candidate_list_key}'", "code": -32602}, node_id=node_id)

                    if not candidates_to_save:
                         logger.warning(f"⚠️ Node '{node_id}': No candidates found in list '{candidate_list_key}' to save.")
                         log_entry.status = "success" # Node completed, even if it did nothing
                         log_entry.output = {"message": "No candidates to save."}
                         log_entry.inputs_used = {"source_key": candidate_list_key} # Indicate where it looked
                         log_entry.details = []
                    else:
                        logger.info(f" Found {len(candidates_to_save)} candidates to save from key '{candidate_list_key}'.")
                        individual_results = []
                        success_count = 0
                        error_count = 0

                        for index, candidate in enumerate(candidates_to_save):
                            call_id = f"{node_id}-item-{index}" # Unique ID for logging sub-calls
                            item_result = {"input_candidate": candidate, "status": "pending", "output": None}
                            try:
                                if not isinstance(candidate, dict):
                                    logger.warning(f" Skipping item {index} in '{candidate_list_key}': not a dictionary.")
                                    raise ValueError("Candidate item is not a dictionary.")

                                # Extract required fields (name, title, skills)
                                name = candidate.get("name")
                                title = candidate.get("title")
                                skills = candidate.get("skills") # Should be a list from webservice_agent

                                # Validate required fields for this *candidate*
                                if not name or not title or skills is None: # Check skills existence too
                                    missing = [f"'{f}'" for f in ['name', 'title', 'skills'] if not candidate.get(f)]
                                    raise ValueError(f"Missing required fields in candidate data: {', '.join(missing)}")
                                if not isinstance(skills, list):
                                     raise ValueError(f"Expected 'skills' to be a list, but got {type(skills)}")


                                params_for_candidate = {
                                    "name": name,
                                    "title": title,
                                    "skills": skills # Pass the list directly
                                }

                                # Call create_record for this specific candidate
                                save_output = await a2a_call(agent_url, method_name, params_for_candidate, node_id, call_id)
                                item_result["status"] = "success"
                                item_result["output"] = save_output
                                success_count += 1

                            except (ValueError, AgentError, HTTPException) as item_err:
                                error_count += 1
                                item_result["status"] = "error"
                                if isinstance(item_err, ValueError):
                                    item_result["output"] = {"error": {"message": str(item_err), "code": -32602}} # Input data error
                                elif isinstance(item_err, AgentError):
                                    item_result["output"] = {"error": item_err.detail}
                                elif isinstance(item_err, HTTPException): # Should ideally not happen here, but catch just in case
                                     item_result["output"] = {"error": {"message": item_err.detail, "code": item_err.status_code}}

                            individual_results.append(item_result)

                        # Summarize results for the main log entry
                        log_entry.details = individual_results
                        log_entry.status = "error" if error_count > 0 and success_count == 0 else \
                                           "partial_success" if error_count > 0 and success_count > 0 else \
                                           "success"
                        log_entry.output = {
                            "message": f"Attempted to save {len(candidates_to_save)} candidates.",
                            "saved_count": success_count,
                            "error_count": error_count
                        }
                        log_entry.inputs_used = {"source_key": candidate_list_key, "count": len(candidates_to_save)}

                        # Decide how to update global state - perhaps just add the summary?
                        global_state[f"{node_id}_summary"] = log_entry.output

                        # If any item failed, we mark the overall workflow potentially as failed or partial
                        if error_count > 0:
                            workflow_status = "failed" if success_count == 0 else "partial_success"
                            # Optionally: uncomment below to halt workflow if *any* save fails
                            # if workflow_status == "failed":
                            #    logger.info(f"Workflow execution halted due to save errors in Node '{node_id}'.")
                            #    node_end_time = time.monotonic()
                            #    log_entry.duration_ms = (node_end_time - node_start_time) * 1000
                            #    logs.append(log_entry)
                            #    return WorkflowExecutionResponse(status=workflow_status, logs=logs, final_state=global_state)


                # --- Default Handling for other methods ---
                else:
                    expected_params = get_expected_params(agent_card, method_name)
                    params_to_send = {
                        k: v for k, v in global_state.items() if k in expected_params
                    }
                    log_entry.inputs_used = params_to_send

                    # Call the agent method
                    output = await a2a_call(agent_url, method_name, params_to_send, node_id)

                    # Update global state
                    if isinstance(output, dict):
                        global_state.update(output)
                        logger.debug(f" Global state updated after Node '{node_id}': {global_state}")
                    elif output is not None:
                        # Determine result key (as before)
                        result_key = "$result"
                        for method_def in agent_card.get("methods", []):
                           if method_def.get("name") == method_name:
                              returns = method_def.get("returns", [])
                              if len(returns) == 1 and returns[0].get("name"):
                                  result_key = returns[0]["name"]
                                  break
                        global_state[result_key] = output
                        logger.debug(f" Non-dict output from Node '{node_id}' stored as '{result_key}'. Global state: {global_state}")

                    # Record success log
                    log_entry.status = "success"
                    log_entry.output = output

            # --- Error Handling for the node ---
            except (HTTPException, AgentError) as e:
                workflow_status = "failed"
                log_entry.status = "error"
                error_detail = {}
                if isinstance(e, AgentError):
                     error_detail = {"error": e.detail}
                     logger.error(f"Workflow failed at Node '{node_id}' due to agent error: {e.detail}")
                elif isinstance(e, HTTPException):
                     error_detail = {"error": {"message": e.detail, "code": e.status_code}}
                     logger.error(f"Workflow failed at Node '{node_id}' due to HTTP error: {e.status_code} - {e.detail}")
                log_entry.output = error_detail
                # Stop workflow execution on node error
                node_end_time = time.monotonic()
                log_entry.duration_ms = (node_end_time - node_start_time) * 1000
                logs.append(log_entry)
                logger.info(f"Workflow execution halted due to error in Node '{node_id}'.")
                return WorkflowExecutionResponse(status=workflow_status, logs=logs, final_state=global_state)

            except Exception as e:
                 workflow_status = "failed"
                 log_entry.status = "error"
                 error_detail_msg = f"Unexpected internal error processing node: {str(e)}"
                 log_entry.output = {"error": {"message": error_detail_msg, "code": -32002}}
                 logger.exception(f"🔥 Workflow failed at Node '{node_id}' due to unexpected error: {e}")
                 node_end_time = time.monotonic()
                 log_entry.duration_ms = (node_end_time - node_start_time) * 1000
                 logs.append(log_entry)
                 logger.info(f"Workflow execution halted due to unexpected error in Node '{node_id}'.")
                 raise HTTPException(status_code=500, detail=error_detail_msg) from e

            # --- Finalize Log Entry ---
            node_end_time = time.monotonic()
            log_entry.duration_ms = (node_end_time - node_start_time) * 1000
            logs.append(log_entry) # Add the completed log entry

        logger.info(f" Workflow execution finished with status: {workflow_status}")
        return WorkflowExecutionResponse(status=workflow_status, logs=logs, final_state=global_state)

    except HTTPException as e:
        logger.error(f"Workflow setup failed: {e.detail}")
        raise e
    except Exception as e:
        logger.exception(f"🔥 Unexpected internal error during workflow orchestration: {e}")
        raise HTTPException(status_code=500, detail=f"Internal orchestration error: {str(e)}")


@app.get("/health")
async def health():
    """Basic health check endpoint."""
    # (No changes needed in this function)
    return {"status": "ok", "service": "lowcode_backend"}