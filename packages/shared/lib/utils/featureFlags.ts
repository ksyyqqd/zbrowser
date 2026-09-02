/**
 * 编译期功能开关。
 *
 * 这里放的是「整块功能要不要存在」级别的开关，和 generalSettings 里的用户偏好不同：
 * 用户看不到、也改不了，改这里需要重新构建。用途是把尚未完工的功能整块摘掉，
 * 而不是把代码删了——留着开关比留着注释掉的代码好维护。
 */

/**
 * MCP（Model Context Protocol）功能总开关。
 *
 * 当前为 false：MCP 实现尚未可用，整块屏蔽。已知阻塞问题：
 * - SSE 传输在 MV3 service worker 里跑不起来（用了 EventSource，该环境不存在此 API），
 *   且未实现 MCP HTTP+SSE 规范要求的 endpoint 事件 / session id 协商；
 * - stdio 传输缺 nativeMessaging 权限、缺 native host 程序，且 connect() 里
 *   waitForReady() 等待的 'connected' 状态在它自己返回后才设置，必然超时；
 * - 剩下的 WebSocket 传输极少有真实 MCP 服务器提供；
 * - 设置页改配置对运行时无效（无 storage 监听，connectServer/disconnectServer 无调用者）。
 *
 * 打开前请先解决上述问题。开关本身只控制「是否接线」，不改动 packages/mcp-client
 * 与 services/mcp 的实现，代码保留在仓库里待修。
 */
export const MCP_ENABLED = false;
