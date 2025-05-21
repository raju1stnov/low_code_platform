curl -X POST http://localhost:9001/api/chat -H "Content-Type: application/json" -d '{
    "prompt": "how about top 5 candidates with python background",
    "session_id": "curl_test_session_001",
    "sink_id": "candidates_db_main"
}'