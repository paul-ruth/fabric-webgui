name: fablib
description: Write FABlib Python code for FABRIC operations
---
Write a Python script using the FABlib library to perform FABRIC operations.

1. **Understand the request**: What FABRIC operation? Create slice, query resources,
   run experiments, analyze data?

2. **Write the Python script**:
   - Import FABlib: `from fabrictestbed_extensions.fablib.fablib import FablibManager`
   - Initialize: `fablib = FablibManager()`
   - Include proper error handling
   - Add comments explaining each section
   - Save to a `.py` file in the working directory

3. **Common operations**:
   - `fablib.get_slices()` — list all slices
   - `fablib.get_slice(name=...)` — get a specific slice
   - `fablib.new_slice(name=...)` — create a new slice
   - `slice.add_node(...)` — add a node
   - `node.add_component(...)` — add hardware
   - `slice.add_l2network(...)` / `slice.add_l3network(...)` — add network
   - `slice.submit()` — submit the slice
   - `node.execute(...)` — run command on a node
   - `fablib.get_resources()` — query available resources

4. **Verify**: Read back the script. Optionally run it if the user requests.

Always use `FablibManager()` (not `fablib.FablibManager()`) for initialization.
The FABRIC config is pre-loaded from the environment in this container.
