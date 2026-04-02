"use strict";

const requestObject = typeof $request !== "undefined" ? $request : null;
const responseObject = typeof $response !== "undefined" ? $response : null;
const url = requestObject && requestObject.url ? requestObject.url : "";
const method = requestObject && requestObject.method ? requestObject.method : "";
const stage = responseObject ? "RESP" : "REQ";

try {
  if (stage === "REQ") {
    console.log(`[XHS-DEBUG][REQ] ${method} ${url}`);
    $done({});
    return;
  }

  const headers = responseObject && responseObject.headers ? responseObject.headers : {};
  const status = responseObject && responseObject.status ? responseObject.status : "";
  const contentType = readHeader(headers, "content-type");
  const contentLength = readHeader(headers, "content-length");
  console.log(`[XHS-DEBUG][RESP] ${status} ${contentType || "-"} len=${contentLength || "-"} ${url}`);
  $done({});
} catch (error) {
  console.log(`[XHS-DEBUG][ERROR] ${error.message} ${url}`);
  $done({});
}

function readHeader(headers, key) {
  if (!headers || typeof headers !== "object") return "";
  const target = key.toLowerCase();

  for (const name of Object.keys(headers)) {
    if (String(name).toLowerCase() === target) {
      return headers[name];
    }
  }

  return "";
}
