import test from 'node:test';
import assert from 'node:assert/strict';
import {groupPose,mediaPose,audioPose} from '../src/groups.js';
const p={x:0,y:0,scale:1,scaleX:1,scaleY:1,opacity:1,rotation:0};
test('group transformation applies the same delta to every base pose without losing relative position',()=>{const next={...p,x:80,y:20,scaleX:2,rotation:45};assert.deepEqual(groupPose(p,p,next),next);const transformed=groupPose({...p,x:30,y:40,scaleX:.5},p,next);assert.equal(transformed.x,110);assert.equal(transformed.y,60);assert.equal(transformed.scaleX,1);assert.equal(transformed.rotation,45);});
test('sparse media defaults to A* with implicit boundary values and interpolates Q* regions',()=>{const keys={4:{...p,x:100},5:{...p,x:100}};assert.equal(mediaPose({},100,0,1000).x,0);assert.equal(mediaPose(keys,2,0,9).x,50);assert.equal(mediaPose(keys,4,0,9).x,100);assert.equal(mediaPose(keys,7,0,9).x,50);assert.equal(mediaPose(keys,9,0,9).x,0);});
test('audio volume and semitone keys interpolate independently and refresh when replaced',()=>{let keys={4:{volume:0,pitch:12},5:{volume:0,pitch:12}};assert.deepEqual(audioPose(keys,2,0,9),{volume:.5,pitch:6});assert.deepEqual(audioPose(keys,7,0,9),{volume:.5,pitch:6});keys={...keys,4:{volume:2,pitch:-12}};assert.deepEqual(audioPose(keys,2,0,9),{volume:1.5,pitch:-6});});
test('media and audio A* interpolate across the loop seam rather than resetting',()=>{const keys={0:{...p,x:100},4:{...p,x:200}};assert.equal(mediaPose(keys,6,0,7,p,true).x,150);assert.deepEqual(audioPose({0:{volume:.5,pitch:12},4:{volume:1,pitch:0}},6,0,7,true),{volume:.75,pitch:6});});
test('hidden audio keys do not leak into a shorter looping clip',()=>{assert.deepEqual(audioPose({100:{volume:0,pitch:24}},3,0,7,true),{volume:1,pitch:0});});
