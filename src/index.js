//DO NOT TOUCH UNLESS YOU KNOW WHAT YOU'RE DOING!!
import { Ai } from './vendor/@cloudflare/ai.js'; // This is an ES module import

// Current version of your API
const version = "1.0.3";

// ID generator
function uuid() {
  let uuid = '';
  const chars = 'abcdef0123456789';
  for (let i = 0; i < 32; i++) {
    const charIndex = Math.floor(Math.random() * chars.length);
    uuid += chars[charIndex];
    if (i === 7 || i === 11 || i === 15 || i === 19) {
      uuid += '-';
    }
  }
  return uuid;
}

// Creating a new map for chat messages
const chats = new Map();

// Creating a new map for requests used for rate limit
const requestCounts = new Map();

// ------------------ CONFIG ------------------ //
const maxMemory = 3;
const preprompt = "You are a helpful and responsive assistant, you answer questions directly and provide instruction unless told otherwise.";
const maxRequest = 100;
const maxRequestsPerMinute = 100;
const ai_model = "@cf/meta/llama-2-7b-chat-int8";
const timezone = "en-US";
const password = 'none';
// --------------- END OF CONFIG --------------- //

var password_locked = (password.toLowerCase() !== 'none');

function checkRateLimit(ip) {
  const currentTime = Date.now();
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, [currentTime]);
    return true;
  } else {
    const requests = requestCounts.get(ip);
    while (requests.length > 0 && currentTime - requests[0] > 60 * 1000) {
      requests.shift();
    }
    if (requests.length < maxRequestsPerMinute) {
      requests.push(currentTime);
      return true;
    } else {
      return false;
    }
  }
}

function updateRateLimit(ip) {
  const currentTime = Date.now();
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, [currentTime]);
  } else {
    const requests = requestCounts.get(ip);
    while (requests.length > 0 && currentTime - requests[0] > 60 * 1000) {
      requests.shift();
    }
    requests.push(currentTime);
  }
}

// This is an ES module export
export default {
  async fetch(request, env, ctx) { // Added ctx for completeness, though not used in this snippet
    const jsonheaders = {
      "content-type": "application/json;charset=UTF-8",
      'Access-Control-Allow-Origin': '*', // Allows all origins
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With', // Broader set of allowed headers
      'Access-Control-Max-Age': '86400',
    };

    // Handle OPTIONS preflight requests for CORS
    if (request.method === 'OPTIONS') {
      // For OPTIONS, we primarily need to send back the Allow-* headers.
      const optionsSpecificHeaders = {
        'Access-Control-Allow-Origin': jsonheaders['Access-Control-Allow-Origin'],
        'Access-Control-Allow-Methods': jsonheaders['Access-Control-Allow-Methods'],
        'Access-Control-Allow-Headers': jsonheaders['Access-Control-Allow-Headers'],
        'Access-Control-Max-Age': jsonheaders['Access-Control-Max-Age'],
      };
      return new Response(null, {
        status: 204, // No Content
        headers: optionsSpecificHeaders
      });
    }

    const tasks = [];
    const url = new URL(request.url);
    const queryParam = url.searchParams.get('q');
    // Gracefully handle cases where queryParam might be null, then decode
    const query = queryParam ? decodeURIComponent(queryParam) : null;

    const id = url.pathname.substring(1);
    
    // Note on `Ai` class:
    // If you have a Cloudflare AI binding configured in your wrangler.toml (e.g., [ai] binding = "AI"),
    // the `Ai` class constructor is typically available through the runtime environment.
    // The `import { Ai } from './vendor/@cloudflare/ai.js';` line suggests you might have a local copy
    // or a specific setup. Ensure this `./vendor/@cloudflare/ai.js` file is also an ES module.
    // If using the standard binding, this import might be unnecessary, and `new Ai(env.AI)` would work directly.
    const ai = new Ai(env.AI);
    
    let client_ip = request.headers.get("CF-Connecting-IP");
    let req_time = new Date().toLocaleTimeString(timezone, {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true
    });

    if (password_locked) {
      if (id !== "api") {
        const client_passed_pass = url.searchParams.get('p');
        if (!client_passed_pass) {
          const error_response = { role: 'API', content: `[Error]: Password is required. IP: ${client_ip}` };
          return new Response(JSON.stringify(error_response), { headers: jsonheaders });
        }
        if (client_passed_pass !== password) {
          const error_response = { role: 'API', content: `[Error]: Invalid password. IP: ${client_ip}` };
          return new Response(JSON.stringify(error_response), { headers: jsonheaders });
        }
      }
    }

    if (!checkRateLimit(client_ip)) {
      const error_response = { role: 'API', content: `[Error]: Rate limit activated (${maxRequestsPerMinute}/min). IP: ${client_ip}` };
      return new Response(JSON.stringify(error_response), { headers: jsonheaders });
    }

    if (!id) {
      const newId = uuid();
      const newUrl = `${url.origin}/${newId}${url.search}`; // Preserve search params on redirect
      return Response.redirect(newUrl, 301);
    }

    let chat = chats.get(id);
    if (!chat) {
      chat = {
        messages: [{ role: 'system', content: preprompt }],
        userId: id,
        messageCount: 0, // This counts user messages added to this session
        client: { ip: client_ip, used_req: 0, max_req: maxRequest, req_time: req_time },
      };
      chats.set(id, chat);
    }

    chat.client.ip = client_ip;
    chat.client.req_time = req_time;

    if (id === "api") {
      const info = {
        URL: url.toString(), AI_MODEL: ai_model, TIMEZONE: timezone, REQUEST_TIME: req_time, CLIENT_IP: client_ip,
        REQUESTS_PER_SESSION: maxRequest, REQUESTS_PER_MINUTE: maxRequestsPerMinute,
        PASSWORD_LOCKED: password_locked, GITHUB: 'https://github.com/localuser-isback/Cloudflare-AI', VERSION: version
      };
      return new Response(JSON.stringify(info), { headers: jsonheaders });
    }
    
    if (!query || query.trim() === "" || query.toLowerCase() === "null") {
      tasks.push({ inputs: chat, response: chat.messages });
      return new Response(JSON.stringify(tasks), { headers: jsonheaders });
    } else {
      if (chat.client.used_req >= maxRequest) {
        const error_page = { role: 'API', content: `[Error]: Max requests per ID (${maxRequest}) reached. IP: ${client_ip}` };
        return new Response(JSON.stringify(error_page, null, 2), { headers: jsonheaders });
      }

      chat.messages.push({ role: 'user', content: query });
      chat.messageCount += 1;
      chat.client.used_req += 1;
      updateRateLimit(client_ip); // Ensure global rate limit is also updated for valid requests

      // Memory management: keep system prompt + last 'maxMemory' exchanges (user + system)
      if (chat.messages.length > 1 + (maxMemory * 2)) { // 1 for system prompt, maxMemory pairs
        const systemPrompt = chat.messages[0]; // Assuming first is always system preprompt
        const recentMessages = chat.messages.slice(-(maxMemory * 2));
        chat.messages = [systemPrompt, ...recentMessages];
      }
      
      try {
        // Pass only the messages array to the AI model
        const aiResponse = await ai.run(ai_model, { messages: chat.messages });
        let aiContent = '';
        // Ensure response is structured as expected (string or object with .response)
        if (aiResponse && typeof aiResponse.response === 'string') {
            aiContent = aiResponse.response;
        } else if (typeof aiResponse === 'string') { // Some models might return string directly
            aiContent = aiResponse;
        } else {
            console.error("Unexpected AI response format:", aiResponse);
            aiContent = "[AI Error: Could not process response format]";
        }
        chat.messages.push({ role: 'system', content: aiContent });
      } catch (e) {
        console.error("Error running AI model:", e);
        chat.messages.push({ role: 'system', content: "[AI Error: An exception occurred during processing]" });
      }
    }

    tasks.push({ inputs: chat, response: chat.messages });
    return new Response(JSON.stringify(tasks), { headers: jsonheaders });
  },
};
