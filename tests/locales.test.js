import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LANGUAGES} from '../src/i18n.js';
test('every UI catalog entry has all nine target translations and ten language options exist',()=>{const catalog=JSON.parse(readFileSync(new URL('../assets/locales/ui.json',import.meta.url),'utf8'));assert.equal(LANGUAGES.length,10);assert(Object.keys(catalog).length>150);for(const [source,translations] of Object.entries(catalog)){assert.equal(translations.length,9,source);assert(translations.every(text=>typeof text==='string'&&text.trim()),source);}assert.equal(catalog['Сохранить'][0],'Save');});
