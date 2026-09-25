import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Conv2pdfApi implements ICredentialType {
	name = 'conv2pdfApi';

	displayName = 'Conv2pdf API';

	icon: Icon = {
		light: 'file:../nodes/Conv2pdf/conv2pdf.svg',
		dark: 'file:../nodes/Conv2pdf/conv2pdf.dark.svg',
	};

	documentationUrl = 'https://github.com/jamalofski/n8n-nodes-conv2pdf#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'cpdf_live_...',
			description:
				'Your conv2pdf API key. Create one from the API section of your conv2pdf dashboard.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Reading the quota is free: it checks the key without using a conversion.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.conv2pdf.com/v1',
			url: '/quota',
			method: 'GET',
		},
	};
}
