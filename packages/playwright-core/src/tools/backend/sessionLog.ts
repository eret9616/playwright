/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';

import { outputFile  } from './context';
import { parseResponse } from './response';

import type { ContextConfig } from './context';
import type * as actions from '@recorder/actions';
import type { Tab } from './tab';

export class SessionLog {
  private _folder: string;
  private _file: string;
  private _cwd: string;
  private _sessionFileQueue = Promise.resolve();
  private _lastUserAction: { name: string; line: string } | undefined;

  constructor(sessionFolder: string, cwd: string) {
    this._folder = sessionFolder;
    this._file = path.join(this._folder, 'session.md');
    this._cwd = cwd;
  }

  static async create(config: ContextConfig, cwd: string): Promise<SessionLog> {
    const sessionFolder = await outputFile({ config, cwd }, `session-${Date.now()}`, { origin: 'code' });
    await fs.promises.mkdir(sessionFolder, { recursive: true });
    // eslint-disable-next-line no-console
    console.error(`Session: ${sessionFolder}`);
    return new SessionLog(sessionFolder, cwd);
  }

  logResponse(toolName: string, toolArgs: Record<string, any>, responseObject: any) {
    const parsed = { ...parseResponse(responseObject, this._cwd), text: undefined };
    const lines: string[] = [''];
    lines.push(
        `### Tool call: ${toolName}`,
        `- Args`,
        '```json',
        JSON.stringify(toolArgs, null, 2),
        '```',
    );
    if (parsed) {
      lines.push(`- Result`);
      lines.push('```json');
      lines.push(JSON.stringify(parsed, null, 2));
      lines.push('```');
    }

    lines.push('');
    this._sessionFileQueue = this._sessionFileQueue.then(() => fs.promises.appendFile(this._file, lines.join('\n')));
    this._lastUserAction = undefined;
  }

  // Record an action that the human user (not an MCP tool call) performed in the
  // browser. chat-server reads `### User action: ...` blocks from session.md to
  // surface manual interactions to the LLM. Mirrors the InputRecorder hookup
  // that existed in 1.58 mcp before the move-to-core refactor (#39440).
  // The `tab` parameter is unused for now but kept to match the legacy signature
  // so future enhancements (e.g. snapshot files) don't need to thread it back through.
  logUserAction(action: actions.Action, _tab: Tab, code: string, isUpdate: boolean) {
    code = code.trim();
    if (isUpdate && this._lastUserAction?.name === action.name) {
      // Replace the in-flight entry instead of appending a duplicate.
      // Best-effort: only collapses when no other entry has been logged in between.
      return;
    }
    const actionRecord = action as Record<string, unknown>;
    if (action.name === 'navigate' && this._lastUserAction?.name === 'navigate') {
      // Navigation events fire repeatedly while a tab loads; drop trailing duplicates.
      const url = actionRecord.url;
      if (typeof url === 'string' && this._lastUserAction.line.includes(`"url":${JSON.stringify(url)}`))
        return;
    }

    const actionData: Record<string, unknown> = { ...actionRecord };
    delete actionData.ariaSnapshot;
    if (actionData.name === 'drag' && actionData.selector)
      actionData.sourceSelector = actionData.selector;
    delete actionData.selector;
    delete actionData.signals;

    const lines: string[] = [''];
    lines.push(
        `### User action: ${action.name}`,
        `- Args`,
        '```json',
        JSON.stringify(actionData, null, 2),
        '```',
    );
    if (code) {
      lines.push(
          `- Code`,
          '```js',
          code,
          '```',
      );
    }
    const argsJson = JSON.stringify(actionData);
    lines.push('');
    this._sessionFileQueue = this._sessionFileQueue.then(() => fs.promises.appendFile(this._file, lines.join('\n')));
    this._lastUserAction = { name: action.name, line: argsJson };
  }
}
