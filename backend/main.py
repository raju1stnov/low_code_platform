import os
import httpx
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
A2A_REGISTRY_URL = os.getenv("A2A_REGISTRY_URL", "http://localhost:8104/a2a")
print("📡 Loaded A2A_REGISTRY_URL =", A2A_REGISTRY_URL)

app = FastAPI(title="LowCode Backend")

class WorkflowNode(BaseModel):
    id: str
    agent: str
    method: str
    inputs: Dict[str, Any] = {}
    next: str = ""

class WorkflowRequest(BaseModel):
    nodes: List[WorkflowNode]
    startNodeId: str

class ExecutionLog(BaseModel):
    nodeId: str
    agent: str
    method: str
    inputs: Dict[str, Any]
    output: Any

class WorkflowResponse(BaseModel):
    logs: List[ExecutionLog]

async def a2a_call(agent_url: str, method: str, params: dict) -> Any:
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    }
    timeout = 10.0
    async with httpx.AsyncClient() as client:
        resp = await client.post(agent_url, json=payload, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise HTTPException(status_code=500, detail=f"A2A Error: {data['error']}")
        return data.get("result")

@app.get("/api/agents")
async def get_agents():
    reg_payload = {
        "jsonrpc": "2.0",
        "method": "list_agents",
        "params": {},
        "id": 1
    }
    try:
        async with httpx.AsyncClient() as client:
            reg_resp = await client.post(A2A_REGISTRY_URL, json=reg_payload, timeout=5.0)
            reg_resp.raise_for_status()
            reg_data = reg_resp.json()
            if "error" in reg_data:
                raise HTTPException(status_code=500, detail=f"Registry error: {reg_data['error']}")
            agents_list = reg_data.get("result", [])
            return agents_list
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Failed to reach registry: {e}")

@app.post("/api/run_workflow", response_model=WorkflowResponse)
async def run_workflow(req: WorkflowRequest):
    try:
        node_map = {n.id: n for n in req.nodes}
        if req.startNodeId not in node_map:
            raise HTTPException(status_code=400, detail=f"Start node '{req.startNodeId}' not found.")

        logs = []
        current_node_id = req.startNodeId
        global_state = {}

        while current_node_id:
            node = node_map[current_node_id]
            agent_card = await _get_agent_card(node.agent)
            expected = get_expected_params(agent_card, node.method)

            # Merge inputs + global state and filter to what this method accepts
            merged_params = {
                k: v for k, v in {**global_state, **node.inputs}.items() if k in expected
            }

            url = agent_card.get("url_ext") or agent_card.get("url")            
            if not url:
                raise HTTPException(status_code=500, detail=f"No valid URL found for agent '{node.agent}'")
            print(f"🚀 Calling {node.agent}.{node.method} → {url} with:", merged_params)

            output = await a2a_call(url, node.method, merged_params)
            if isinstance(output, dict):
                global_state.update(output)

            logs.append(ExecutionLog(
                nodeId=node.id,
                agent=node.agent,
                method=node.method,
                inputs=node.inputs,
                output=output
            ))

            current_node_id = node.next if node.next else None

        return WorkflowResponse(logs=logs)

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

def get_expected_params(agent_card: dict, method: str):
    for m in agent_card.get("methods", []):
        if m["name"] == method:
            return [p["name"] for p in m.get("params", [])]
    return []

async def _get_agent_card(agent_name: str) -> dict:
    payload = {
        "jsonrpc": "2.0",
        "method": "get_agent",
        "params": {"name": agent_name},
        "id": 1
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(A2A_REGISTRY_URL, json=payload, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise HTTPException(status_code=500, detail=f"Registry agent lookup error: {data['error']}")
        agent_card = data.get("result", {})
        if not agent_card:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found.")
        return agent_card

@app.get("/health")
async def health():
    return {"status": "ok", "service": "lowcode_backend"}