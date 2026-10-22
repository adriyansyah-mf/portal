# Clairty password portal for RouterOS v7 Container.
# Edit every value in this section before importing.
:local portalPassword "CHANGE_ME_LONG_RANDOM_PASSWORD"
:local portalOrigin "https://wifi.clairty.example:8443"
:local routerApiUrl "https://router.clairty.example"
:local imageFile "disk1/clairty-portal-arm64.tar"
:local storageRoot "disk1/containers/clairty-portal"

:if ($portalPassword = "CHANGE_ME_LONG_RANDOM_PASSWORD") do={ :error "Edit portalPassword before importing" }

/interface/veth add name=veth-clairty address=172.31.250.2/30 gateway=172.31.250.1
/interface/bridge add name=bridge-clairty
/ip/address add address=172.31.250.1/30 interface=bridge-clairty
/interface/bridge/port add bridge=bridge-clairty interface=veth-clairty

/user/group add name=clairty-portal policy=read,write,sensitive,rest-api
/user add name=clairty-portal group=clairty-portal password=$portalPassword address=172.31.250.2/32

/container/envs add list=clairty-env key=HOST value="0.0.0.0"
/container/envs add list=clairty-env key=PORT value="3000"
/container/envs add list=clairty-env key=PUBLIC_ORIGIN value=$portalOrigin
/container/envs add list=clairty-env key=MIKROTIK_URL value=$routerApiUrl
/container/envs add list=clairty-env key=MIKROTIK_USERNAME value="clairty-portal"
/container/envs add list=clairty-env key=MIKROTIK_PASSWORD value=$portalPassword
/container/envs add list=clairty-env key=TLS_CERT_FILE value="/certs/portal.crt"
/container/envs add list=clairty-env key=TLS_KEY_FILE value="/certs/portal.key"
/container/envs add list=clairty-env key=NODE_EXTRA_CA_CERTS value="/certs/router-ca.pem"

/container/mounts add list=clairty-certs src=disk1/clairty-certs dst=/certs
/container add file=$imageFile interface=veth-clairty root-dir=$storageRoot envlist=clairty-env mountlists=clairty-certs name=clairty-portal start-on-boot=yes logging=yes memory-high=96M memory-max=128M

/ip/firewall/nat add chain=dstnat action=dst-nat protocol=tcp dst-port=8443 in-interface-list=LAN to-addresses=172.31.250.2 to-ports=3000 comment="Clairty password portal"
/ip/firewall/filter add chain=forward action=accept protocol=tcp dst-address=172.31.250.2 dst-port=3000 in-interface-list=LAN comment="Allow Clairty portal"
/ip/firewall/filter add chain=input action=accept protocol=tcp src-address=172.31.250.2 dst-port=443 comment="Clairty portal to RouterOS REST"
/ip/firewall/filter add chain=forward action=drop src-address=172.31.250.2 comment="Isolate Clairty portal container"

:put "Wait until /container print shows status=stopped, then run: /container/start [find where name=clairty-portal]"
