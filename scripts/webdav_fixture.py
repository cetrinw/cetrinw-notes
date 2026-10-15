"""Local authenticated WebDAV protocol fixture; writes actual files in a temp directory."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import base64, pathlib, tempfile, urllib.parse, xml.etree.ElementTree as ET
with tempfile.TemporaryDirectory(prefix='cetrinw-webdav-') as directory:
    root=pathlib.Path(directory).resolve()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def auth(self):
            if self.headers.get('Authorization')=='Basic '+base64.b64encode(b'fixture:local-protocol-test').decode():return True
            self.send_response(401);self.end_headers();return False
        def path_file(self):
            name=urllib.parse.unquote(urllib.parse.urlparse(self.path).path).lstrip('/')
            file=(root/name).resolve()
            if not file.is_relative_to(root):raise ValueError('path traversal')
            return file
        def send(self,status,body=b''):
            self.send_response(status);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_MKCOL(self):
            if not self.auth():return
            p=self.path_file()
            if p.exists():self.send(405)
            else:p.mkdir();self.send(201)
        def do_PUT(self):
            if not self.auth():return
            p=self.path_file()
            if p.exists() and self.headers.get('If-None-Match')=='*':self.send(412);return
            p.write_bytes(self.rfile.read(int(self.headers['Content-Length'])));self.send(201)
        def do_GET(self):
            if not self.auth():return
            p=self.path_file();self.send(200,p.read_bytes()) if p.is_file() else self.send(404)
        def do_PROPFIND(self):
            if not self.auth():return
            p=self.path_file()
            if not p.exists():self.send(404);return
            xml=ET.Element('{DAV:}multistatus')
            paths=[p]+(list(p.iterdir()) if p.is_dir() and self.headers.get('Depth')=='1' else [])
            for f in paths:
                r=ET.SubElement(xml,'{DAV:}response');ET.SubElement(r,'{DAV:}href').text='/'+str(f.relative_to(root));ps=ET.SubElement(r,'{DAV:}propstat');prop=ET.SubElement(ps,'{DAV:}prop');ET.SubElement(prop,'{DAV:}getcontentlength').text=str(f.stat().st_size);ET.SubElement(ps,'{DAV:}status').text='HTTP/1.1 200 OK'
            self.send(207,ET.tostring(xml))
    HTTPServer(('127.0.0.1',14324),Handler).serve_forever()
