#!/bin/bash

cd "$(dirname "$0")/server"

echo "正在启动图片处理服务..."
echo "服务地址: http://localhost:8720"
echo "按 Ctrl+C 停止服务"
echo ""

node index.js
