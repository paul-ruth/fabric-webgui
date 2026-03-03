Query current CPU load and dataplane traffic for a FABRIC site.

Usage: `/site-metrics <site-name>` (e.g., `/site-metrics RENC`)

## Steps

1. **Parse the site name** from `$ARGUMENTS`. If empty, ask the user which site to query.

2. **Query metrics**
   - `curl -s http://localhost:8000/api/metrics/site/<site-name> | python3 -m json.tool`
   - If the backend isn't running, try the public endpoint directly:
     `curl -sk "https://public-metrics.fabric-testbed.net/grafana/api/datasources/proxy/1/api/v1/query?query=node_load1{rack=\"<site-name-lowercase>\"}" | python3 -m json.tool`

3. **Format results**
   Display a clean summary:
   - Site: <name>
   - Load 1m / 5m / 15m: values per worker
   - Dataplane In: total bits/sec (converted to Mbps or Gbps)
   - Dataplane Out: total bits/sec (converted to Mbps or Gbps)

4. **Interpret**
   - If load > number of cores: site may be overloaded
   - If dataplane traffic is very high: note potential congestion
   - If no data returned: site may be down or name may be incorrect. List available sites with `curl -s http://localhost:8000/api/sites | python3 -c "import sys,json; [print(s['name']) for s in json.load(sys.stdin)]"` if backend is running.
