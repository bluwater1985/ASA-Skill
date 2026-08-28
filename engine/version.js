// engine/version.js
const ENGINE_VERSION = '3.x';
const MIN_SCHEMA_VERSION = 3;
const MAX_SUPPORTED_SCHEMA = 4; // v4: 新增 ISSUE 节点族（问题管理）

module.exports = {
  ENGINE_VERSION,
  MIN_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA
};
