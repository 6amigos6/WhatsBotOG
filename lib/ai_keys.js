const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'ai_keys.json');

const DEFAULT_KEYS = {
  gpt: { key: '', enabled: true, provider: 'openai' },
  openrouter: { key: '', enabled: true, provider: 'openrouter' },
  imagine: { key: '', enabled: true, provider: 'pollinations' },
  image: { key: '', enabled: true, provider: 'pollinations' },
};

function loadKeys() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_KEYS));
}

function saveKeys(keys) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(keys, null, 2));
    return true;
  } catch (e) {
    console.error('ai_keys save error:', e.message);
    return false;
  }
}

function getKey(service) {
  const keys = loadKeys();
  const config = keys[service];
  if (!config || !config.enabled) return null;
  return config.key || null;
}

function setKey(service, key) {
  const keys = loadKeys();
  if (!keys[service]) keys[service] = { key: '', enabled: true, provider: 'pollinations' };
  keys[service].key = key;
  return saveKeys(keys);
}

function setEnabled(service, enabled) {
  const keys = loadKeys();
  if (!keys[service]) keys[service] = { key: '', enabled: true, provider: 'pollinations' };
  keys[service].enabled = enabled;
  return saveKeys(keys);
}

function deleteKey(service) {
  const keys = loadKeys();
  if (keys[service]) {
    keys[service].key = '';
    keys[service].enabled = false;
  }
  return saveKeys(keys);
}

function getAllServices() {
  const keys = loadKeys();
  return Object.entries(keys).map(([name, config]) => ({
    name,
    hasKey: !!config.key,
    enabled: config.enabled,
    provider: config.provider || 'pollinations',
    keyPreview: config.key ? config.key.substring(0, 8) + '...' : 'Not set',
  }));
}

module.exports = { getKey, setKey, setEnabled, deleteKey, getAllServices, loadKeys, saveKeys };
