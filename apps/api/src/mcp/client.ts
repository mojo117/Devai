/**
 * MCP Client
 *
 * Generic MCP client that connects to an MCP server via stdio transport,
 * discovers available tools, and can call them.
 */

import type { McpServerConfig } from './config.js'

async function importModule<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<T>
  return dynamicImport(specifier)
}

export interface McpToolInfo {
  /** Original tool name from the MCP server */
  name: string
  /** Tool description */
  description: string
  /** JSON Schema for input parameters */
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: McpToolInfo['inputSchema']
}

interface McpListToolsResponse {
  tools: McpToolDefinition[]
}

interface McpContentBlock {
  type: string
  text?: string
}

interface McpCallToolResponse {
  content: McpContentBlock[]
  isError?: boolean
}

interface McpClientInterface {
  connect(transport: McpTransportInterface): Promise<void>
  listTools(): Promise<McpListToolsResponse>
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<McpCallToolResponse>
  close(): Promise<void>
}

interface McpTransportInterface {
  // Transport interface marker - actual methods are internal to MCP SDK
}

export class McpClient {
  private client: McpClientInterface | null = null
  private transport: McpTransportInterface | null = null
  private connected = false;
  readonly config: McpServerConfig;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /**
   * Connect to the MCP server process
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    console.info(`[mcp:${this.config.name}] Connecting via stdio: ${this.config.command} ${this.config.args.join(' ')}`);

    const { Client } = await importModule<{ Client: new (...args: unknown[]) => McpClientInterface }>(
      '@modelcontextprotocol/sdk/client/index.js'
    )
      .catch((err) => {
        throw new Error(`MCP SDK not available (missing @modelcontextprotocol/sdk). ${err instanceof Error ? err.message : String(err)}`)
      })
    const { StdioClientTransport } = await importModule<{ StdioClientTransport: new (...args: unknown[]) => McpTransportInterface }>(
      '@modelcontextprotocol/sdk/client/stdio.js'
    )
      .catch((err) => {
        throw new Error(`MCP stdio transport not available. ${err instanceof Error ? err.message : String(err)}`)
      })

    const client = new Client(
      { name: `devai-${this.config.name}`, version: '1.0.0' },
      { capabilities: {} },
    )
    this.client = client

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: {
        ...process.env,
        ...this.config.env,
      } as Record<string, string>,
    })

    await this.client.connect(this.transport)
    this.connected = true;

    console.info(`[mcp:${this.config.name}] Connected`);
  }

  /**
   * List available tools from the MCP server
   */
  async listTools(): Promise<McpToolInfo[]> {
    if (!this.connected || !this.client) {
      throw new Error(`MCP client "${this.config.name}" is not connected`)
    }

    const response = await this.client.listTools()

    return (response.tools || []).map((tool: McpToolDefinition) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: (tool.inputSchema as McpToolInfo['inputSchema']) || {
        type: 'object' as const,
        properties: {},
      },
    }))
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: string; isError: boolean }> {
    if (!this.connected || !this.client) {
      throw new Error(`MCP client "${this.config.name}" is not connected`)
    }

    const result = await this.client.callTool({ name, arguments: args })

    // Extract text content from the MCP response
    const textContent = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('\n') || JSON.stringify(result.content)

    return {
      content: textContent,
      isError: result.isError === true,
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.connected || !this.client) return

    try {
      await this.client.close()
      console.info(`[mcp:${this.config.name}] Disconnected`)
    } catch (error) {
      console.warn(`[mcp:${this.config.name}] Error during disconnect:`, error)
    }

    this.connected = false
    this.transport = null
  }
}
