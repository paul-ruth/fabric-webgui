name: network
description: Design a network topology for a FABRIC experiment
---
Design and document a network topology for a FABRIC experiment.

1. **Understand requirements**:
   - How many nodes and what roles?
   - Same-site or cross-site connectivity?
   - Bandwidth requirements?
   - IP addressing needs?

2. **Choose network type**:
   - **L2Bridge**: Same site, Layer 2, good for local experiments
   - **L2STS**: Cross-site Layer 2, direct connectivity between sites
   - **L2PTP**: Point-to-point, exactly 2 endpoints
   - **FABNetv4**: Cross-site routed IPv4 (auto-configured, easiest)
   - **FABNetv6**: Cross-site routed IPv6
   - **L3VPN**: Cross-site VPN with routing

3. **Design the topology**:
   - Choose appropriate NIC models
   - Plan IP addressing (subnets, gateways)
   - Consider co-location with @group tags
   - Document the network diagram

4. **Output**: Provide the network section of a template.fabric.json,
   or create a complete slice template if requested.

Guidelines:
- Use FABNetv4 for simple cross-site IP connectivity
- Use L2STS for custom L2 protocols or when you need raw Ethernet
- NIC_Basic is sufficient for most experiments (shared, 1 port)
- NIC_ConnectX_5/6 for dedicated 25/100Gbps performance
- Each NIC_ConnectX has 2 ports — can connect to 2 different networks
