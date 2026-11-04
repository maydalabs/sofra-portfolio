/** Only a safe outcome crosses from the revision action to the client. */
export type ReviseHostedTableResult = {
  status:
    | 'saved'
    | 'unavailable'
    | 'not_certified'
    | 'not_editable'
    | 'not_found'
    | 'invalid_request'
    | 'unexpected_error'
}
