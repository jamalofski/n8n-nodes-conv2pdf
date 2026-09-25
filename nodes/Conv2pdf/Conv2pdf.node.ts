import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPairedItemData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { OPERATIONS, properties, type FileResource } from './descriptions';
import {
	apiError,
	conv2pdfRequest,
	fileNameFromDisposition,
	header,
	jsonBody,
	stopsTheRun,
	type FullResponse,
} from './transport';

type NodeError = NodeApiError | NodeOperationError;

interface InputFile {
	buffer: Buffer;
	fileName: string;
	mimeType: string;
}

interface ConvertOptions {
	deleteAfterDownload?: boolean;
	outputBinaryPropertyName?: string;
}

async function readFile(
	this: IExecuteFunctions,
	itemIndex: number,
	propertyName: string,
): Promise<InputFile> {
	const binary = this.helpers.assertBinaryData(itemIndex, propertyName);
	const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);
	return {
		buffer,
		fileName: binary.fileName ?? `${propertyName}.${binary.fileExtension ?? 'bin'}`,
		mimeType: binary.mimeType,
	};
}

/** The multipart fields of the tool behind the operation, read from the node parameters. */
function toolFields(this: IExecuteFunctions, operation: string, itemIndex: number): IDataObject {
	switch (operation) {
		case 'extractPages':
			return { ranges: this.getNodeParameter('ranges', itemIndex) as string };
		case 'compress':
			return { quality: this.getNodeParameter('quality', itemIndex) as string };
		case 'protect': {
			const restrictions = this.getNodeParameter('restrictions', itemIndex, {}) as IDataObject;
			return {
				password: this.getNodeParameter('password', itemIndex) as string,
				...(restrictions.preventPrint ? { prevent_print: 'on' } : {}),
				...(restrictions.preventCopy ? { prevent_copy: 'on' } : {}),
			};
		}
		case 'unlock':
			return { password: this.getNodeParameter('password', itemIndex) as string };
		case 'rotate':
			return { rotation: this.getNodeParameter('rotation', itemIndex) as string };
		case 'addWatermark':
			return { text: this.getNodeParameter('text', itemIndex) as string };
		case 'addPageNumbers':
			return {
				format: this.getNodeParameter('numberFormat', itemIndex) as string,
				position: this.getNodeParameter('position', itemIndex) as string,
			};
		case 'convertToImages':
			return { format: this.getNodeParameter('imageFormat', itemIndex) as string };
		default:
			return {};
	}
}

/**
 * Sends the files to conv2pdf, downloads the result and, unless told otherwise, deletes it
 * from the server. Returns the output item without its pairedItem.
 */
async function convert(
	this: IExecuteFunctions,
	tool: string,
	files: InputFile[],
	fields: IDataObject,
	options: ConvertOptions,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const form = new FormData();
	for (const file of files) {
		form.append('file', new Blob([file.buffer], { type: file.mimeType }), file.fileName);
	}
	for (const [name, value] of Object.entries(fields)) form.append(name, String(value));

	const converted = await conv2pdfRequest.call(this, {
		method: 'POST',
		url: `/convert/${tool}`,
		body: form as unknown as IDataObject,
	});
	if (converted.statusCode !== 200) throw apiError.call(this, converted, itemIndex);
	const job = jsonBody(converted);
	const jobId = String(job.job_id);

	const download = await conv2pdfRequest.call(this, {
		method: 'GET',
		url: `/download/${jobId}`,
		encoding: 'arraybuffer',
	});
	if (download.statusCode !== 200) throw apiError.call(this, download, itemIndex);

	if (options.deleteAfterDownload !== false) {
		// Best effort: conv2pdf deletes the file after one hour anyway.
		await conv2pdfRequest.call(this, { method: 'DELETE', url: `/job/${jobId}` });
	}

	const fileName =
		fileNameFromDisposition(header(download, 'content-disposition')) ?? `conv2pdf-${jobId}`;
	const mimeType = header(download, 'content-type')?.split(';')[0].trim();
	const binary = await this.helpers.prepareBinaryData(
		Buffer.from(download.body as ArrayBuffer),
		fileName,
		mimeType,
	);
	return {
		json: job,
		binary: { [options.outputBinaryPropertyName || 'data']: binary },
	};
}

export class Conv2pdf implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'conv2pdf',
		name: 'conv2pdf',
		icon: { light: 'file:conv2pdf.svg', dark: 'file:conv2pdf.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Convert and edit PDFs with the conv2pdf API: Office documents and images to PDF, PDF to Word, merge, compress and more',
		defaults: {
			name: 'conv2pdf',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'conv2pdfApi',
				required: true,
			},
		],
		properties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const continueOnFail = this.continueOnFail();
		const returnData: INodeExecutionData[] = [];

		const fail = (error: NodeError, pairedItem: IPairedItemData | IPairedItemData[]) => {
			if (!continueOnFail) throw error;
			returnData.push({ json: { error: error.message }, pairedItem });
		};

		const asNodeError = (error: unknown, itemIndex: number): NodeError =>
			error instanceof NodeApiError || error instanceof NodeOperationError
				? error
				: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });

		if (resource === 'account' && operation === 'getQuota') {
			for (let i = 0; i < items.length; i++) {
				let response: FullResponse;
				try {
					response = await conv2pdfRequest.call(this, { method: 'GET', url: '/quota' });
				} catch (error) {
					fail(asNodeError(error, i), { item: i });
					continue;
				}
				if (response.statusCode === 200) {
					returnData.push({ json: jsonBody(response), pairedItem: { item: i } });
				} else {
					fail(apiError.call(this, response, i), { item: i });
				}
			}
			return [returnData];
		}

		const spec = OPERATIONS[resource as FileResource]?.[operation];
		if (!spec) {
			throw new NodeOperationError(
				this.getNode(),
				`The operation "${operation}" is not supported for the resource "${resource}"`,
			);
		}

		// One request for all the input items: their files become one merged PDF.
		if (operation === 'merge' && this.getNodeParameter('mergeMode', 0) === 'items') {
			const pairedItem = items.map((_, i) => ({ item: i }));
			try {
				const files: InputFile[] = [];
				for (let i = 0; i < items.length; i++) {
					const propertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					files.push(await readFile.call(this, i, propertyName));
				}
				const options = this.getNodeParameter('options', 0, {}) as ConvertOptions;
				const output = await convert.call(this, spec.tool, files, {}, options, 0);
				returnData.push({ ...output, pairedItem });
			} catch (error) {
				fail(asNodeError(error, 0), pairedItem);
			}
			return [returnData];
		}

		// Set once no other request of the run can succeed: the key is rejected, the quota is
		// used up, the trial has expired or the API is unreachable.
		let stopError: NodeError | undefined;
		for (let i = 0; i < items.length; i++) {
			if (stopError) {
				fail(stopError, { item: i });
				continue;
			}
			try {
				let files: InputFile[];
				if (operation === 'merge') {
					const names = (this.getNodeParameter('binaryPropertyNames', i) as string)
						.split(',')
						.map((name) => name.trim())
						.filter((name) => name !== '');
					files = [];
					for (const name of names) files.push(await readFile.call(this, i, name));
				} else {
					const propertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					files = [await readFile.call(this, i, propertyName)];
				}
				const fields = toolFields.call(this, operation, i);
				const options = this.getNodeParameter('options', i, {}) as ConvertOptions;
				const output = await convert.call(this, spec.tool, files, fields, options, i);
				returnData.push({ ...output, pairedItem: { item: i } });
			} catch (error) {
				const nodeError = asNodeError(error, i);
				// No HTTP response at all (network failure or timeout) also stops the run.
				const noResponse = !(error instanceof NodeApiError || error instanceof NodeOperationError);
				if (stopsTheRun(error) || noResponse) stopError = nodeError;
				fail(nodeError, { item: i });
			}
		}

		return [returnData];
	}
}
