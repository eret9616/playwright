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

import { z } from 'playwright-core/lib/mcpBundle';
import { defineTabTool } from './tool';

import type * as playwright from 'playwright-core';
import type { Request } from '../../../../../playwright-core/src/client/network';

const requests = defineTabTool({
  capability: 'core',

  schema: {
    name: 'browser_network_requests',
    title: 'List network requests',
    description: 'Returns all network requests since loading the page',
    inputSchema: z.object({
      includeStatic: z.boolean().default(false).describe('Whether to include successful static resources like images, fonts, scripts, etc. Defaults to false.'),
    }),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const requests = await tab.requests();
    const requestArray = Array.from(requests);
    for (let i = 0; i < requestArray.length; i++) {
      const rendered = await renderRequest(requestArray[i], params.includeStatic, i);
      if (rendered)
        response.addResult(rendered);
    }
  },
});

async function renderRequest(request: playwright.Request, includeStatic: boolean, reqid: number): Promise<string | undefined> {
  const response = (request as Request)._hasResponse ? await request.response() : undefined;
  const isStaticRequest = ['document', 'stylesheet', 'image', 'media', 'font', 'script', 'manifest'].includes(request.resourceType());
  const isSuccessfulRequest = !response || response.status() < 400;

  if (isStaticRequest && isSuccessfulRequest && !includeStatic)
    return undefined;

  const result: string[] = [];
  result.push(`[${reqid}] [${request.method().toUpperCase()}] ${request.url()}`);
  if (response)
    result.push(`=> [${response.status()}] ${response.statusText()}`);
  return result.join(' ');
}

// Maximum size for request/response body content
const BODY_SIZE_LIMIT = 10000;

function truncateText(text: string, limit: number): string {
  if (text.length > limit) {
    return text.substring(0, limit) + '... <truncated>';
  }
  return text;
}

const requestDetail = defineTabTool({
  capability: 'core',

  schema: {
    name: 'browser_network_request_detail',
    title: 'Get network request detail',
    description: 'Get detailed information about a specific network request including headers, body, and response',
    inputSchema: z.object({
      reqid: z.number().describe('The request ID from browser_network_requests output (the number in brackets at the start of each line)'),
    }),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const requests = await tab.requests();
    const requestArray = Array.from(requests);
    const request = requestArray[params.reqid];

    if (!request) {
      response.addResult(`Error: Request with id ${params.reqid} not found`);
      return;
    }

    const result: string[] = [];

    // Basic info
    result.push('## Request');
    result.push(`URL: ${request.url()}`);
    result.push(`Method: ${request.method()}`);
    result.push(`Resource Type: ${request.resourceType()}`);

    // Request headers
    result.push('\n### Request Headers');
    const reqHeaders = request.headers();
    for (const [name, value] of Object.entries(reqHeaders)) {
      result.push(`- ${name}: ${value}`);
    }

    // Request body (POST data)
    const postData = request.postData();
    if (postData) {
      result.push('\n### Request Body');
      result.push(truncateText(postData, BODY_SIZE_LIMIT));
    }

    // Response info
    const httpResponse = (request as Request)._hasResponse ? await request.response() : undefined;
    if (httpResponse) {
      result.push('\n## Response');
      result.push(`Status: ${httpResponse.status()} ${httpResponse.statusText()}`);

      // Response headers
      result.push('\n### Response Headers');
      const resHeaders = httpResponse.headers();
      for (const [name, value] of Object.entries(resHeaders)) {
        result.push(`- ${name}: ${value}`);
      }

      // Response body
      result.push('\n### Response Body');
      try {
        const body = await httpResponse.text();
        if (body.length === 0) {
          result.push('<empty response>');
        } else {
          result.push(truncateText(body, BODY_SIZE_LIMIT));
        }
      } catch {
        result.push('<not available>');
      }
    } else {
      result.push('\n## Response');
      result.push('No response available (request may be pending or failed)');
    }

    response.addResult(result.join('\n'));
  },
});

export default [
  requests,
  requestDetail,
];
