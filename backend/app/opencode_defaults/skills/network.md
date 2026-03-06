name: network
description: Design a network topology for a FABRIC experiment
---
Design and document a network topology for a FABRIC experiment.

## Steps

1. **Understand requirements**:
   - How many nodes and what roles?
   - Same-site or cross-site connectivity?
   - Bandwidth and latency requirements?
   - IP addressing needs (private L2, routed L3, public)?
   - Special requirements (VLAN tagging, port mirroring, sub-interfaces)?

2. **Choose network type** — use `fabric_list_components` to see all options:

   | Type | Use Case | Cross-site? | Auto-IP? |
   |------|----------|-------------|----------|
   | L2Bridge | Same-site switched LAN | No | No |
   | L2STS | Cross-site Layer 2 tunnel | Yes | No |
   | L2PTP | Point-to-point link (2 nodes) | Yes | No |
   | FABNetv4 | Routed IPv4 via FABRIC backbone | Yes | Yes |
   | FABNetv6 | Routed IPv6 via FABRIC backbone | Yes | Yes |
   | FABNetv4Ext | Publicly routable IPv4 | Yes | Yes |
   | FABNetv6Ext | Publicly routable IPv6 | Yes | Yes |
   | PortMirror | Traffic capture/analysis | N/A | No |

3. **Choose NIC model**:

   | Model | Speed | Ports | Features |
   |-------|-------|-------|----------|
   | NIC_Basic | 25Gbps shared | 1 | Default, sufficient for most experiments |
   | NIC_ConnectX_5 | 25Gbps dedicated | 2 | DPDK, RDMA, programmable |
   | NIC_ConnectX_6 | 100Gbps dedicated | 2 | DPDK, RDMA, programmable |
   | NIC_ConnectX_7_100 | 100Gbps dedicated | 2 | Latest generation |
   | NIC_ConnectX_7_400 | 400Gbps dedicated | 2 | Highest bandwidth |
   | NIC_BlueField_2_ConnectX_6 | 100Gbps | 2 | DPU with ARM cores |

4. **Design the topology**:
   - Plan IP addressing (subnets, gateways)
   - Consider co-location (same site = lower latency, L2Bridge possible)
   - For cross-site: FABNetv4/v6 is simplest (auto-configured routing)
   - For custom protocols: L2STS gives raw Ethernet cross-site
   - Multi-homed nodes: use dedicated NICs (ConnectX_5/6) with 2 ports

5. **Create the slice**: Use `fabric_create_slice` with network specs, or
   use the `fabnet` shorthand for easy L3.

## Common Patterns

### Simple Cross-site L3 (Recommended)
```
fabric_create_slice(
  slice_name="cross-site",
  nodes=[
    {name: "n1", site: "STAR", fabnet: "v4"},
    {name: "n2", site: "TACC", fabnet: "v4"}
  ]
)
```
Nodes get auto-assigned IPs on the 10.128.0.0/10 FABRIC backbone. Ping just works.

### Same-site L2 LAN
```
fabric_create_slice(
  slice_name="local-lan",
  nodes=[
    {name: "n1", site: "STAR"},
    {name: "n2", site: "STAR"},
    {name: "n3", site: "STAR"}
  ],
  networks=[
    {name: "lan", type: "L2Bridge", interfaces: ["n1", "n2", "n3"],
     subnet: "192.168.1.0/24"}
  ]
)
```

### Cross-site L2 (for custom protocols)
```
networks=[
  {name: "tunnel", type: "L2STS", interfaces: ["n1", "n2"],
   subnet: "10.0.0.0/24"}
]
```

### High-performance with dedicated NICs
Use `nic_model: "NIC_ConnectX_6"` on nodes that need 100Gbps dedicated bandwidth.
Each ConnectX NIC has 2 ports — can connect to 2 different networks.

### Sub-interfaces (VLAN tagging)
For multiple logical networks on a single physical NIC, use FABlib Python API:
```python
iface = node.add_component(model="NIC_ConnectX_6", name="nic1").get_interfaces()[0]
child1 = iface.add_sub_interface("vlan100", vlan="100")
child2 = iface.add_sub_interface("vlan200", vlan="200")
```
This requires a Python script — not available via the tool interface.

### Port Mirroring (traffic analysis)
Requires FABlib Python API — not available via tools:
```python
slice.add_port_mirror_service(name="mirror", mirror_interface_name="n1-nic1-p1",
                              receive_interface=recv_iface)
```

## Key Subnets

- FABRIC IPv4 backbone: `10.128.0.0/10` (FABNetv4)
- FABRIC IPv6 backbone: `2602:fcfb::/40` (FABNetv6)
- Public IPv4: `23.134.232.0/22` (FABNetv4Ext, limited)

## Guidelines

- Use FABNetv4 for simple cross-site IP connectivity — simplest option
- Use L2STS for custom L2 protocols or when you need raw Ethernet cross-site
- NIC_Basic is sufficient for most experiments (shared, 1 port)
- NIC_ConnectX_5/6/7 for dedicated performance, DPDK, RDMA
- Each ConnectX NIC has 2 ports — can connect to 2 different networks
- L2PTP is strictly 2 endpoints — use L2STS for more
- Always check site availability before creating: `fabric_find_sites`
