/**
 * What the engine needs to serve the business's presentation menu document.
 *
 * Only the parts that vary per deployment: the customer-facing title and where
 * the file lives on disk. The public URL and MIME type are engine constants
 * (see `CatalogDocumentService`) — every business serves one PDF at `/api/menu`.
 */
export interface CatalogDocumentConfig {
  /** Customer-facing title shown when the document is attached to a reply. */
  title: string;
  /** Repository-relative path to the asset streamed by `GET /api/menu`. */
  path: string;
}
