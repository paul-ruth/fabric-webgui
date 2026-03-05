name: sites
description: Query FABRIC site information and resource availability
---
Help the user understand FABRIC site resources and availability.

1. **List sites**: Show the available FABRIC sites with their locations.

2. **Resource info**: If the user asks about a specific site, check availability by
   running a Python script:
   ```python
   from fabrictestbed_extensions.fablib.fablib import FablibManager
   fablib = FablibManager()
   resources = fablib.get_resources()
   site = resources.get_site("SITE_NAME")
   print(f"Cores: {site.get_cpu_capacity()} total, {site.get_cpu_available()} available")
   print(f"RAM: {site.get_ram_capacity()}GB total, {site.get_ram_available()}GB available")
   print(f"Disk: {site.get_disk_capacity()}GB total, {site.get_disk_available()}GB available")
   ```

3. **Recommendations**: Based on the user's resource needs, suggest appropriate sites.

Key sites:
- RENC (Raleigh, NC) — Primary hub site, high capacity
- TACC (Austin, TX) — GPUs, high capacity
- UCSD (San Diego, CA) — West coast hub
- STAR (Chicago, IL) — Central hub
- MASS (Amherst, MA) — Northeast
- UTAH (Salt Lake City, UT) — GPUs available
- DALL (Dallas, TX) — South central
- WASH (Washington, DC) — East coast
