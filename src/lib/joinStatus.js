// join_group() / request_to_join_group() return a status string rather than a
// membership id (0028, audit LOGIC-5). They used to return the new row's id,
// which was NULL whenever `on conflict do nothing` fired -- so a repeat join,
// or a join against a membership that had already been *denied*, looked
// identical to success and the UI cheerfully said "Request sent."
const JOIN_MESSAGE = {
  requested: "Request sent.",
  already_pending: "You've already asked to join — the admin hasn't decided yet.",
  already_approved: "You're already a member of this group.",
  already_denied: "Your previous request to join this group was declined.",
};

/** Human-readable result of a join attempt. Unknown statuses read as success. */
export function describeJoinResult(status) {
  return JOIN_MESSAGE[status] ?? JOIN_MESSAGE.requested;
}

/** True only when this attempt actually created a pending request. */
export function joinCreatedRequest(status) {
  return status === "requested";
}
