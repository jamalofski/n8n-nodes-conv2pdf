# n8n-nodes-conv2pdf

Official [n8n](https://n8n.io) node for the [conv2pdf API](https://conv2pdf.com/en/api/): convert Word, Excel, PowerPoint and images to PDF, convert PDF to Word, and merge, split, compress, protect, rotate or number PDFs, straight from your workflows. Processing runs on OVH servers in Gravelines, France: no transfer outside the EU, no US service in the chain.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Usage](#usage) · [Output](#output) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/): in n8n, open **Settings > Community Nodes**, select **Install** and enter `n8n-nodes-conv2pdf`.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Office Document | Convert to PDF | Word, Excel, PowerPoint or OpenDocument file to PDF |
| Image | Convert to PDF | PNG, JPG, WebP, GIF or TIFF image to PDF |
| Image | Convert HEIC to JPG | iPhone HEIC or HEIF photo to JPG |
| Image | Convert HEIC to PDF | iPhone HEIC or HEIF photo to PDF |
| PDF | Add Page Numbers | Number the pages, as "X of N" or "X", bottom center, left or right |
| PDF | Add Watermark | Stamp a text of up to 50 characters on every page |
| PDF | Compress | Reduce the size, keeping images at 72, 150 or 300 DPI |
| PDF | Convert to Images | One PNG or JPG per page, in a ZIP file |
| PDF | Convert to Word | Editable DOCX document |
| PDF | Extract Pages | Keep the pages you list, such as `1-5,7,10-12`, in a new PDF |
| PDF | Merge | Combine several PDFs into one |
| PDF | Protect | Set a password, and optionally forbid printing or copying |
| PDF | Rotate | Turn every page by 90, 180 or 270 degrees |
| PDF | Unlock | Remove a password you know |
| Account | Get Quota | Plan, usage and limits of the API key |

## Credentials

1. Create an account on [conv2pdf.com](https://conv2pdf.com/en/api/). The Dev plan includes 300 free conversions, valid for 12 months; see [pricing](https://conv2pdf.com/en/api/pricing/) for the paid plans.
2. Create an API key, which starts with `cpdf_live_`, from the API section of your dashboard.
3. In n8n, create a **Conv2pdf API** credential and paste the key. The credential test reads your quota, which uses no conversion.

## Usage

- **Input file.** Each operation reads the file from a binary field of the input item, `data` by default, as produced by the Read Files, HTTP Request or Google Drive nodes. conv2pdf checks the content of the file, not its name.
- **Merge.** In *One File per Input Item* mode, the node merges the file of every input item, in order, into a single PDF. In *Several Files in Each Item* mode, it merges the binary fields you list, such as `data, data_1`, into one PDF per item. The Dev plan merges 2 files at a time, paid plans up to 20.
- **Result.** The converted file comes out in the `data` binary field, or the one set in **Options**. The node then deletes the job from conv2pdf; turn **Delete From Server After Download** off to keep it, and conv2pdf deletes it after one hour.
- **Limits.** Files can weigh up to 10 MB on the Dev plan and 200 MB on paid plans. The API accepts 20 conversions per minute per API key: when it asks to slow down, or when its queue is full, the node waits for the delay the API gives (`Retry-After`) and tries again, up to five times.
- **Errors.** With the node's **On Error** setting on *Continue*, a failed item comes out with an `error` field and the others carry on. A rejected API key, a spent quota, expired trial credits or an unreachable API stop the requests for the rest of the run. Failed conversions do not count against your quota.
- **AI agents.** The n8n AI Agent can use the node as a tool, for example to check the remaining quota. File operations need their input file in a binary field, which agents do not pass.

Every request carries `User-Agent: n8n-nodes-conv2pdf/<version>`. Mention it when you contact support: it tells your calls apart in the API's logs.

## Output

Each output item carries the converted file in its binary field, and the conversion job as returned by the API in its JSON:

| Field | Meaning |
|---|---|
| `job_id` | Identifier of the conversion job |
| `size_bytes` | Size of the converted file |
| `quota` | Plan, usage and limits of the API key after this conversion |

**Account > Get Quota** returns the `quota` object on its own. The full reference is in the [API documentation](https://conv2pdf.com/en/api/docs/).

## Compatibility

Built and tested against `n8n-workflow` 2.40.

## Resources

- [conv2pdf API documentation](https://conv2pdf.com/en/api/docs/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Support

Open an [issue](https://github.com/jamalofski/n8n-nodes-conv2pdf/issues) or write to contact@conv2pdf.com.

## License

MIT, see [LICENSE](LICENSE).
