/**
 * Domain tools for CSV exploration, cleaning, and pandas data analysis.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'data-scenario-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  // 1. inspect_csv
  ctx.tools.register(defineTool({
    name: 'inspect_csv',
    description: 'Inspect a CSV file to retrieve row count, column names, missing values, duplicates, and sample data.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Absolute or relative path to the CSV file to inspect.',
      },
      sample_rows: {
        type: 'number',
        description: 'Number of sample rows to return (default: 5).',
      },
    },
    output: {
      schema: {
        type: 'json',
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      const targetPath = resolve(process.cwd(), args.file_path)
      if (!existsSync(targetPath)) {
        return Promise.resolve({
          error: `File not found: ${targetPath}`,
        })
      }

      // Use a fast inline python inspect script with pandas
      const sampleCount = args.sample_rows ?? 5
      const pyScript = `
import json, sys, pandas as pd
df = pd.read_csv(r'''${targetPath}''')
result = {
    'total_rows': int(len(df)),
    'columns': list(df.columns),
    'null_counts': {col: int(cnt) for col, cnt in df.isna().sum().to_dict().items()},
    'duplicate_rows': int(df.duplicated().sum()),
    'sample': df.head(${sampleCount}).fillna("").to_dict(orient='records')
}
print(json.dumps(result))
`
      const res = spawnSync('uv', ['run', '--with', 'pandas', 'python', '-c', pyScript], {
        encoding: 'utf-8',
        timeout: 15_000,
      })

      if (res.status !== 0) {
        return Promise.resolve({
          error: `Failed to inspect CSV: ${res.stderr || res.stdout}`,
        })
      }

      try {
        const parsed = JSON.parse(res.stdout.trim())
        return Promise.resolve(parsed)
      } catch (err) {
        return Promise.resolve({
          error: `JSON parse error on inspection: ${String(err)}`,
          raw_output: res.stdout,
        })
      }
    },
  }))

  // 2. execute_python_code
  ctx.tools.register(defineTool({
    name: 'execute_python_code',
    description: 'Execute a Python script with pandas via `uv` and return its stdout, stderr, and exit status.',
    parameters: {
      code: {
        type: 'string',
        required: true,
        description: 'The Python code to execute.',
      },
      timeout_seconds: {
        type: 'number',
        description: 'Execution timeout in seconds (default: 30).',
      },
    },
    output: {
      schema: {
        type: 'json',
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      const timeoutMs = (args.timeout_seconds ?? 30) * 1000
      const res = spawnSync('uv', ['run', '--with', 'pandas', 'python', '-c', args.code], {
        encoding: 'utf-8',
        timeout: timeoutMs,
      })

      return Promise.resolve({
        success: res.status === 0,
        exit_code: res.status ?? -1,
        stdout: res.stdout ?? '',
        stderr: res.stderr ?? '',
      })
    },
  }))

  // 3. write_file
  ctx.tools.register(defineTool({
    name: 'write_file',
    description: 'Write text or code content to a file at the specified path.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Target path to write the file to.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'The text or code content to write.',
      },
    },
    output: {
      schema: {
        type: 'json',
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      const targetPath = resolve(process.cwd(), args.file_path)
      mkdirSync(dirname(targetPath), { recursive: true })
      writeFileSync(targetPath, args.content, 'utf-8')
      return Promise.resolve({
        success: true,
        path: targetPath,
        bytes_written: Buffer.byteLength(args.content, 'utf-8'),
      })
    },
  }))

  // 4. read_file
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read the contents of a text or script file.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path of the file to read.',
      },
    },
    output: {
      schema: {
        type: 'json',
      },
      render: (_args, value) => [{
        type: 'text',
        text: typeof value === 'object' && value && 'content' in value ? String((value as Record<string, unknown>).content) : JSON.stringify(value, null, 2),
      }],
    },
    execute(args) {
      const targetPath = resolve(process.cwd(), args.file_path)
      if (!existsSync(targetPath)) {
        return Promise.resolve({ error: `File not found: ${targetPath}` })
      }
      const content = readFileSync(targetPath, 'utf-8')
      return Promise.resolve({
        content,
        lines: content.split('\n').length,
      })
    },
  }))
}
