#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');

const config = {
  appId: process.env.FB_APP_ID,
  appSecret: process.env.FB_APP_SECRET,
  pageId: process.env.FB_PAGE_ID || 'mt3uk',
  apiVersion: 'v20.0',
  outputDir: './events-data',
  imageDir: './events-data/images',
};

if (!config.appId || !config.appSecret) {
  console.error('✗ FB_APP_ID and FB_APP_SECRET must be set as environment variables.');
  process.exit(1);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'MT3UK/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('MT3UK Facebook Events Sync');
  ensureDir(config.outputDir);
  ensureDir(config.imageDir);
  
  const accessToken = `${config.appId}|${config.appSecret}`;
  const fields = 'id,name,description,start_time,end_time,place,cover';
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.pageId}/events?fields=${fields}&access_token=${encodeURIComponent(accessToken)}&limit=100`;
  
  try {
    console.log('Fetching events from Facebook...');
    const data = await makeRequest(url);
    
    if (data.error) {
      console.error('Facebook API error:', data.error.message);
      process.exit(1);
    }
    
    console.log(`✓ Fetched ${data.data.length} events`);
    
    const manifest = {
      generated: new Date().toISOString(),
      totalEvents: data.data.length,
      events: data.data,
    };
    
    fs.writeFileSync(
      path.join(config.outputDir, 'events-manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('✓ Saved events-manifest.json');
  } catch (error) {
    console.error('✗ Sync failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) main();
