(function (root) {
  function upcomingGrants(grants, now = new Date()) {
    const nowMs = new Date(now).getTime();
    return grants
      .map((grant, index) => ({
        grant,
        index,
        deadlineMs: grant.deadlineAt ? Date.parse(grant.deadlineAt) : null,
      }))
      .filter(({ grant, deadlineMs }) =>
        !grant.deadlineAt || (Number.isFinite(deadlineMs) && deadlineMs >= nowMs)
      )
      .sort((a, b) =>
        (a.deadlineMs ?? Infinity) - (b.deadlineMs ?? Infinity) || a.index - b.index
      )
      .map(({ grant }) => grant);
  }

  const api = { upcomingGrants };
  if (root) root.LokiFunding = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
