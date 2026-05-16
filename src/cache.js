// Store our cached promises and their expiration times
const sessionCache = new Map();

// 30 minutes in milliseconds
const CACHE_TTL_MS = 30 * 60 * 1000;

// Mock function representing your heavy generation process
function generateSession(url, options = {}) {
    return fetch('http://localhost:3000/cf-clearance-scraper', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            url: url,
            mode: "waf-session",
            proxy: options?.proxy,
        })
    }).then(res => res.json()).catch(err => { console.error(err); return null });
}

export async function getSession(url, options = {}) {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;

    const now = Date.now();
    const cached = sessionCache.get(domain);

    // 1. Return cached promise if it exists and hasn't expired
    if (cached && cached.expiresAt > now) {
        return cached.promise;
    }

    // 2. Otherwise, initiate the heavy generation
    const generationPromise = generateSession(url, options);

    // 3. Store the PROMISE in the cache immediately, along with expiration
    sessionCache.set(domain, {
        promise: generationPromise,
        expiresAt: now + CACHE_TTL_MS
    });

    try {
        // 4. Await the promise and return the actual session object
        return await generationPromise;
    } catch (error) {
        // 5. If generation fails, remove it from the cache so the next request can try again
        sessionCache.delete(domain);
        throw error;
    }
}