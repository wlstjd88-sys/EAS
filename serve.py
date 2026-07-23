#!/usr/bin/env python3
import http.server, socketserver, socket
PORT=8080
class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
host=socket.gethostbyname(socket.gethostname())
print(f'컴퓨터: http://localhost:{PORT}')
print(f'같은 Wi-Fi의 아이폰: http://{host}:{PORT}')
with socketserver.TCPServer(('0.0.0.0',PORT),Handler) as httpd:httpd.serve_forever()
