'use strict';

// Runs against the compiled node: `npm test` builds first.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Conv2pdf } = require('../dist/nodes/Conv2pdf/Conv2pdf.node.js');
const { fileNameFromDisposition } = require('../dist/nodes/Conv2pdf/transport.js');
const { version } = require('../package.json');

const NODE = {
	id: 'test-node',
	name: 'conv2pdf',
	type: 'n8n-nodes-conv2pdf.conv2pdf',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const BASE = 'https://api.conv2pdf.com/v1';

function json(statusCode, body, headers = {}) {
	return { statusCode, headers, body };
}

function file(body, name, type) {
	return json(200, Buffer.from(body), {
		'content-type': type,
		'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
	});
}

// A conv2pdf double: every conversion succeeds, downloads return the file, deletes return 200.
function api(overrides = {}) {
	let jobs = 0;
	return (options) => {
		if (options.method === 'POST') {
			jobs += 1;
			const id = `job${jobs}`;
			return json(200, { job_id: id, status: 'success', download_url: `/v1/download/${id}`, size_bytes: 3 });
		}
		if (options.method === 'GET' && options.url.includes('/download/')) {
			return file('PDF', 'report.pdf', 'application/pdf');
		}
		if (options.method === 'DELETE') return json(200, { deleted: true });
		if (options.url === `${BASE}/quota`) return json(200, { plan: 'starter', quota: 1000, used: 42 });
		throw new Error(`unexpected ${options.method} ${options.url}`);
	};
}

// Minimal IExecuteFunctions: parameters, binary helpers and the authenticated request helper.
function run({ files = [['report.docx']], parameters, continueOnFail = false, respond = api() }) {
	const items = files.map((names) => ({
		json: {},
		binary: Object.fromEntries(
			names.map((name, index) => [
				index === 0 ? 'data' : `data_${index}`,
				{ fileName: name, mimeType: 'application/octet-stream', data: '' },
			]),
		),
	}));
	const calls = [];
	const context = {
		getInputData: () => items,
		getNodeParameter: (name, itemIndex, fallback) =>
			name in parameters ? parameters[name] : fallback,
		continueOnFail: () => continueOnFail,
		getNode: () => NODE,
		helpers: {
			assertBinaryData: (itemIndex, propertyName) => {
				const binary = items[itemIndex].binary[propertyName];
				if (!binary) throw new Error(`No binary data property "${propertyName}"`);
				return binary;
			},
			getBinaryDataBuffer: async (itemIndex, propertyName) =>
				Buffer.from(`content of ${items[itemIndex].binary[propertyName].fileName}`),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
			httpRequestWithAuthentication: async (credentialType, options) => {
				calls.push({ credentialType, options });
				return respond(options, calls.length);
			},
		},
	};
	const promise = new Conv2pdf().execute.call(context).then(([output]) => output);
	return { promise, calls };
}

const route = (call) => `${call.options.method} ${call.options.url}`;

test('converts a file: upload, download of the result, deletion from the server', async () => {
	const { promise, calls } = run({
		parameters: { resource: 'document', operation: 'convertToPdf', binaryPropertyName: 'data' },
	});
	const [item] = await promise;

	assert.deepEqual(calls.map(route), [
		`POST ${BASE}/convert/office-to-pdf`,
		`GET ${BASE}/download/job1`,
		`DELETE ${BASE}/job/job1`,
	]);
	const upload = calls[0].options;
	assert.equal(calls[0].credentialType, 'conv2pdfApi');
	assert.equal(upload.headers['User-Agent'], `n8n-nodes-conv2pdf/${version}`);
	assert.equal(upload.timeout, 120000);
	const sent = upload.body.getAll('file');
	assert.equal(sent.length, 1);
	assert.equal(sent[0].name, 'report.docx');
	assert.equal(await sent[0].text(), 'content of report.docx');
	assert.equal(calls[1].options.encoding, 'arraybuffer');

	assert.equal(item.json.job_id, 'job1');
	assert.deepEqual(item.binary.data, {
		data: Buffer.from('PDF').toString('base64'),
		fileName: 'report.pdf',
		mimeType: 'application/pdf',
	});
	assert.deepEqual(item.pairedItem, { item: 0 });
});

test('sends the fields of the operation', async () => {
	const { promise, calls } = run({
		files: [['doc.pdf']],
		parameters: {
			resource: 'pdf',
			operation: 'protect',
			binaryPropertyName: 'data',
			password: 's3cret',
			restrictions: { preventPrint: true, preventCopy: false },
		},
	});
	await promise;

	const form = calls[0].options.body;
	assert.equal(route(calls[0]), `POST ${BASE}/convert/protect-pdf`);
	assert.equal(form.get('password'), 's3cret');
	assert.equal(form.get('prevent_print'), 'on');
	assert.equal(form.get('prevent_copy'), null);
});

test('maps each operation to its conv2pdf tool and fields', async () => {
	const cases = [
		[{ resource: 'pdf', operation: 'extractPages', ranges: '1-3,7' }, 'split-pdf', { ranges: '1-3,7' }],
		[{ resource: 'pdf', operation: 'compress', quality: 'low' }, 'compress-pdf', { quality: 'low' }],
		[{ resource: 'pdf', operation: 'rotate', rotation: '180' }, 'rotate-pdf', { rotation: '180' }],
		[{ resource: 'pdf', operation: 'addWatermark', text: 'DRAFT' }, 'watermark-pdf', { text: 'DRAFT' }],
		[
			{ resource: 'pdf', operation: 'addPageNumbers', numberFormat: 'simple', position: 'bottom-right' },
			'page-numbers-pdf',
			{ format: 'simple', position: 'bottom-right' },
		],
		[{ resource: 'pdf', operation: 'convertToImages', imageFormat: 'jpg' }, 'pdf-to-image', { format: 'jpg' }],
		[{ resource: 'pdf', operation: 'convertToWord' }, 'pdf-to-word', {}],
		[{ resource: 'pdf', operation: 'unlock', password: 'old' }, 'unlock-pdf', { password: 'old' }],
		[{ resource: 'image', operation: 'convertToPdf' }, 'image-to-pdf', {}],
		[{ resource: 'image', operation: 'heicToJpg' }, 'heic-to-jpg', {}],
		[{ resource: 'image', operation: 'heicToPdf' }, 'heic-to-pdf', {}],
	];
	for (const [parameters, tool, fields] of cases) {
		const { promise, calls } = run({ parameters: { binaryPropertyName: 'data', ...parameters } });
		await promise;
		assert.equal(route(calls[0]), `POST ${BASE}/convert/${tool}`);
		const sent = Object.fromEntries(
			[...calls[0].options.body.entries()].filter(([name]) => name !== 'file'),
		);
		assert.deepEqual(sent, fields, tool);
	}
});

test('keeps the file on the server when asked to', async () => {
	const { promise, calls } = run({
		parameters: {
			resource: 'document',
			operation: 'convertToPdf',
			binaryPropertyName: 'data',
			options: { deleteAfterDownload: false, outputBinaryPropertyName: 'pdf' },
		},
	});
	const [item] = await promise;

	assert.equal(calls.length, 2);
	assert.ok(item.binary.pdf);
});

test('merges the file of every input item into one PDF', async () => {
	const { promise, calls } = run({
		files: [['a.pdf'], ['b.pdf'], ['c.pdf']],
		parameters: { resource: 'pdf', operation: 'merge', mergeMode: 'items', binaryPropertyName: 'data' },
	});
	const output = await promise;

	assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1);
	assert.deepEqual(
		calls[0].options.body.getAll('file').map((sent) => sent.name),
		['a.pdf', 'b.pdf', 'c.pdf'],
	);
	assert.equal(output.length, 1);
	assert.deepEqual(output[0].pairedItem, [{ item: 0 }, { item: 1 }, { item: 2 }]);
});

test('merges several binary fields of the same item', async () => {
	const { promise, calls } = run({
		files: [['a.pdf', 'b.pdf']],
		parameters: {
			resource: 'pdf',
			operation: 'merge',
			mergeMode: 'fields',
			binaryPropertyNames: 'data, data_1',
		},
	});
	await promise;

	assert.deepEqual(
		calls[0].options.body.getAll('file').map((sent) => sent.name),
		['a.pdf', 'b.pdf'],
	);
});

test('waits for Retry-After on a rate limit, then retries', async () => {
	const conv2pdf = api();
	const started = Date.now();
	const { promise, calls } = run({
		parameters: { resource: 'document', operation: 'convertToPdf', binaryPropertyName: 'data' },
		respond: (options, n) =>
			n === 1
				? json(429, { error: 'rate_limited', retry_after: 1, limit: 20 }, { 'retry-after': '1' })
				: conv2pdf(options),
	});
	const [item] = await promise;

	assert.equal(route(calls[1]), `POST ${BASE}/convert/office-to-pdf`);
	assert.ok(Date.now() - started >= 1000, 'the retry waited for Retry-After');
	assert.equal(item.json.job_id, 'job1');
});

test('stops at a spent quota instead of retrying', async () => {
	const { promise, calls } = run({
		files: [['a.docx'], ['b.docx'], ['c.docx']],
		continueOnFail: true,
		parameters: { resource: 'document', operation: 'convertToPdf', binaryPropertyName: 'data' },
		respond: () => json(429, { error: 'quota_exceeded', plan: 'dev', quota: 300, used: 330 }),
	});
	const output = await promise;

	assert.equal(calls.length, 1);
	assert.equal(output.length, 3);
	for (const item of output) {
		assert.equal(item.json.error, 'The conv2pdf quota of this API key is used up');
	}
});

test('fails the node with a clear message when the API key is rejected', async () => {
	const { promise } = run({
		parameters: { resource: 'document', operation: 'convertToPdf', binaryPropertyName: 'data' },
		respond: () => json(401, { error: 'invalid_api_key' }),
	});

	await assert.rejects(promise, (error) => {
		assert.equal(error.message, 'Invalid conv2pdf API key');
		assert.equal(error.httpCode, '401');
		return true;
	});
});

test('a file error only fails its own item', async () => {
	const conv2pdf = api();
	const { promise } = run({
		files: [['locked.pdf'], ['open.pdf']],
		continueOnFail: true,
		parameters: { resource: 'pdf', operation: 'compress', binaryPropertyName: 'data', quality: 'medium' },
		respond: (options, n) =>
			n === 1 ? json(422, { error: 'needs_password', plan: 'starter' }) : conv2pdf(options),
	});
	const output = await promise;

	assert.equal(output[0].json.error, 'The PDF is protected with a password');
	assert.equal(output[1].json.job_id, 'job1');
});

test('stops at the first network failure', async () => {
	const { promise, calls } = run({
		files: [['a.docx'], ['b.docx']],
		continueOnFail: true,
		parameters: { resource: 'document', operation: 'convertToPdf', binaryPropertyName: 'data' },
		respond: () => {
			throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
		},
	});
	const output = await promise;

	assert.equal(calls.length, 1);
	assert.equal(output.length, 2);
	assert.ok(output.every((item) => typeof item.json.error === 'string'));
});

test('reports a missing input file as an item error, without calling the API', async () => {
	const { promise, calls } = run({
		continueOnFail: true,
		parameters: { resource: 'document', operation: 'convertToPdf', binaryPropertyName: 'attachment' },
	});
	const [item] = await promise;

	assert.equal(calls.length, 0);
	assert.match(item.json.error, /attachment/);
});

test('reads the quota of the API key', async () => {
	const { promise, calls } = run({
		files: [[]],
		parameters: { resource: 'account', operation: 'getQuota' },
	});
	const output = await promise;

	assert.equal(route(calls[0]), `GET ${BASE}/quota`);
	assert.deepEqual(output[0].json, { plan: 'starter', quota: 1000, used: 42 });
});

test('reads the output file name from Content-Disposition', () => {
	assert.equal(
		fileNameFromDisposition(`attachment; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`),
		'résumé.pdf',
	);
	assert.equal(fileNameFromDisposition('attachment; filename="plain.pdf"'), 'plain.pdf');
	assert.equal(fileNameFromDisposition(undefined), undefined);
});
