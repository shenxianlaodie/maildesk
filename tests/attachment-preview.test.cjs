const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('backend/public/desk/app.js','utf8');
const start=source.indexOf('function attachmentPreviewType('),end=source.indexOf('\nasync function previewAttachment',start);
const ctx={};vm.runInNewContext(source.slice(start,end),ctx);
test('preview identifies safe image and PDF formats from bytes, not filename or MIME claims',()=>{
 for(const [hex,type] of [['89504e470d0a1a0a','image/png'],['ffd8ffe0','image/jpeg'],['474946383961','image/gif'],['524946460000000057454250','image/webp'],['255044462d312e37','application/pdf']])assert.equal(ctx.attachmentPreviewType(Buffer.from(hex,'hex')),type);
 for(const content of ['<html><script>alert(1)</script>','<svg onload="alert(1)">','not an image',''])assert.equal(ctx.attachmentPreviewType(Buffer.from(content)),'');
});
