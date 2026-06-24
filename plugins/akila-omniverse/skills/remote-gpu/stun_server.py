"""Minimal STUN (RFC 5389) Binding responder for local/Tailscale WebRTC.

Listens on UDP 0.0.0.0:3478. For each Binding Request it replies with a
Binding Success Response carrying XOR-MAPPED-ADDRESS of the sender. That is all
the Omniverse streaming client needs to finish ICE gathering; the actual media
then flows to the host candidate (the box Tailscale IP) advertised by Kit.
"""
import socket
import struct
import sys

MAGIC = 0x2112A442
PORT = 3478


def xor_mapped_address(ip: str, port: int) -> bytes:
    xport = port ^ (MAGIC >> 16)
    ip_int = struct.unpack("!I", socket.inet_aton(ip))[0]
    xip = ip_int ^ MAGIC
    value = struct.pack("!BBH", 0, 0x01, xport) + struct.pack("!I", xip)
    return struct.pack("!HH", 0x0020, len(value)) + value


def main() -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", PORT))
    print(f"STUN responder listening on 0.0.0.0:{PORT}", flush=True)
    while True:
        try:
            data, addr = sock.recvfrom(2048)
            if len(data) < 20:
                continue
            msg_type, _msg_len, magic = struct.unpack("!HHI", data[:8])
            txid = data[8:20]
            # 0x0001 = Binding Request
            if msg_type == 0x0001 and magic == MAGIC:
                attr = xor_mapped_address(addr[0], addr[1])
                resp = struct.pack("!HHI", 0x0101, len(attr), MAGIC) + txid + attr
                sock.sendto(resp, addr)
                print(f"binding from {addr[0]}:{addr[1]} -> ok", flush=True)
        except Exception as e:  # keep serving despite a bad packet
            print(f"err: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
