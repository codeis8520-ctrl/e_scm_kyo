/**
 * VAN 에이전트 CORS 프록시
 * ─────────────────────────────────────────────────────────────────
 * Vercel(HTTPS) 환경에서 브라우저가 로컬 VAN 에이전트(HTTP)를
 * 직접 호출하면 CORS 오류가 발생할 수 있음.
 * 이 스크립트가 CORS 헤더를 추가하는 중간 프록시 역할을 함.
 *
 * 사용법:
 *   1. Node.js 설치 (https://nodejs.org)
 *   2. node cors-proxy.js
 *   3. Vercel 환경변수: NEXT_PUBLIC_CARD_TERMINAL_URL=http://localhost:7002
 *
 * Windows 시작프로그램 등록:
 *   Win + R → shell:startup → 아래 내용의 .bat 파일 생성
 *   ────────────────────────────────
 *   @echo off
 *   node "C:\경로\cors-proxy.js"
 *   ────────────────────────────────
 *
 * VAN 에이전트가 CORS를 자체 지원하면 이 파일 불필요.
 */

const http = require('http');

const TARGET_PORT = 7001;  // VAN 에이전트 포트 (설치 시 안내되는 포트로 변경)
const PROXY_PORT  = 7002;  // 브라우저가 호출할 포트 (Vercel 환경변수에 설정)

http.createServer((req, res) => {
  // CORS 헤더 추가
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Preflight 요청 처리
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // VAN 에이전트로 요청 전달
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    const options = {
      hostname: 'localhost',
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `localhost:${TARGET_PORT}`,
        'content-length': body.length,
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[CORS Proxy] VAN 에이전트 연결 실패:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        resultCode: 'ERR',
        resultMsg: `VAN 에이전트(localhost:${TARGET_PORT})에 연결할 수 없습니다. 에이전트가 실행 중인지 확인하세요.`,
      }));
    });

    proxyReq.write(body);
    proxyReq.end();
  });

}).listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[CORS Proxy] 시작됨: localhost:${PROXY_PORT} → localhost:${TARGET_PORT}`);
  console.log('[CORS Proxy] 종료: Ctrl + C');
});
