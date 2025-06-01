//DO NOT TOUCH UNLESS YOU KNOW WHAT YOU'RE DOING!!
import { Ai } from './vendor/@cloudflare/ai.js';

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

// Messages stored, don't go over 5 since if history too large AI returns null
const maxMemory = 3;
// Give your AI a prompt for specific instructions if you want to fine-tune
const preprompt = "You are a helpful and responsive assistant, you answer questions directly and provide instruction unless told otherwise.";
// Max number of requests allowed per-ID, ex: https://your-api.com/[ID], will be improved later
const maxRequest = 100;
// Max number of requests GLOBALLY per minute
const maxRequestsPerMinute = 100;
// Find more models at https://developers.cloudflare.com/workers-ai/models/text-generation
const ai_model = "@cf/meta/llama-2-7b-chat-int8";
// Timezone for req_time, set to your timezone of choice
const timezone = "en-US";
// Require a password to your API, change 'none' to your password of choice or keep it unlocked with 'none'
const password = 'none';

// --------------- END OF CONFIG --------------- //

//will be defined automataclly
var password_locked = undefined;

if (password.toLowerCase() !== 'none') {
  password_locked = true;
} else {
  password_locked = false;
}

function checkRateLimit(ip) {
  const currentTime = Date.now();
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, [currentTime]);
    return true;
  } else {
    const requests = requestCounts.get(ip);
    // Remove expired requests (older than a minute)
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
    // Remove expired requests (older than a minute)
    while (requests.length > 0 && currentTime - requests[0] > 60 * 1000) {
      requests.shift();
    }
    requests.push(currentTime);
  }
}

export default {
  async fetch(request, env) {
    // Defining variables
    const tasks = [];
    const url = new URL(request.url);
    const query = decodeURIComponent(url.searchParams.get('q'));
    const id = url.pathname.substring(1);
    const ai = new Ai(env.AI);
    // CORS headers & JSON, modify if you know what you're doing.
    const jsonheaders = {
      "content-type": "application/json;charset=UTF-8",
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    // Defining time & getting client IP via Cloudflare
    let client_ip = request.headers.get("CF-Connecting-IP");
    let req_time = new Date().toLocaleTimeString(timezone, {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true
    });

    // Check if a password is enabled
    if (password_locked == true) {
      // If it is then get the password param
      // If the user is going anywhere except the API details page
      if (id !== "api") {
        const client_passed_pass = url.searchParams.get('p');
        // If the param isn't sent
        if (!client_passed_pass) {
          const error_response = {
            role: 'API',
            content: `[Error]: Password is required but not provided, please use ?p= parameter to pass a valid password or &p= if you are sending a request with a query already. IP: ` + client_ip,
          };
          return new Response(JSON.stringify(error_response), {
            headers: jsonheaders,
          });
        }
        // If the password is wrong
        if (client_passed_pass !== password) {
          const error_response = {
            role: 'API',
            content: `[Error]: Password is required but not provided, please use ?p= parameter to pass a valid password or &p= if you are sending a request with a query already. IP: ` + client_ip,
          };
          return new Response(JSON.stringify(error_response), {
            headers: jsonheaders,
          });
        }
      }
    }

    if (!checkRateLimit(client_ip)) {
      // Return a rate limit error response
      const error_response = {
        role: 'API',
        content: `[Error]: Rate limit activated, no more than ${maxRequestsPerMinute} requests per minute. IP: ${client_ip}`,
      };
      return new Response(JSON.stringify(error_response), {
        headers: jsonheaders,
      });
    }

    // If the user does not supply ID, make one
    if (!id) {
      const newId = uuid();
      const newUrl = `${url.origin}/${newId}`;
      return Response.redirect(newUrl, 301);
    }

    let chat = chats.get(id);

    // Chat JSON
    if (!chat) {
      chat = {
        messages: [],
        userId: id,
        messageCount: 0,
        client: {
          ip: client_ip,
          used_req: 0,
          max_req: maxRequest,
          req_time: req_time
        },
      };
      chats.set(id, chat);
      chat.messages.push({ role: 'system', content: preprompt });
    }

    // Update variables per-request
    chat.client.ip = client_ip;
    chat.client.req_time = req_time;

    // If no query is supplied, return messages
    if (!query) {
      tasks.push({ inputs: chat, response: chat.messages });
      return new Response(JSON.stringify(tasks), {
        headers: jsonheaders,
      });
    }

    if (id == "api") {
      const info = {
        URL: url,
        AI: ai_model,
        TIMEZONE: timezone,
        REQUEST_TIME: req_time,
        CLIENT_IP: client_ip,
        REQUESTS_PER_SESSION: maxRequest,
        REQUESTS_PER_MINUTE: maxRequestsPerMinute,
        PASSWORD_LOCKED: password_locked,
        GITHUB: 'https://github.com/localuser-isback/Cloudflare-AI', // Keep if epic.
        VERSION: version
      };
      return new Response(JSON.stringify(info), {
        headers: jsonheaders,
      });
    }

    if (query === "null" || query == undefined) {
      tasks.push({ inputs: chat, response: chat.messages });
      return new Response(JSON.stringify(tasks), {
        headers: jsonheaders,
      });
    } else {
      // Rate limit & user messages
      chat.messages.push({ role: 'user', content: query });
      chat.messageCount += 1;
      chat.client.used_req += 1;
      updateRateLimit(client_ip);

      // Removes previous messages but 1 when max memory reached
      if (chat.messageCount >= maxMemory + 1) {
        chat.messages = chat.messages.slice(-2);
        chat.messageCount = 0;
      }

      // Rate limit check
      if (chat.client.used_req >= maxRequest) {
        // Return an API error
        const error_page = {
          role: 'API',
          content: `[Error]: Rate limit activated, no more than ${maxRequest} requests per ID. IP: ${client_ip}`,
        };
        return new Response(JSON.stringify(error_page, null, 2), {
          headers: jsonheaders,
        });
      }

      // Send data to AI and return response
      let response = await ai.run(ai_model, chat);
      chat.messages.push({ role: 'system', content: response });
    }

    // Push the chatTask into tasks once after processing the request
    tasks.push({ inputs: chat, response: chat.messages });

    return new Response(JSON.stringify(tasks), {
      headers: jsonheaders,
    });
  },
};
