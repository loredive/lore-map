// La page d'un groupe de textes : son nom, sa description, ses textes (ceux du cœur d'abord).
import { S, esc, clusterById, docRow, isHidden, nameOf, textOf, groupName, groupDesc } from "./state.js";
import { registerPage } from "./pages.js";
import { select } from "./panel.js";
import { snippet } from "./links.js";

const groupOfArgs = ({ id, label }) => clusterById(id) || S.clusters.find(x => x.label === label);

registerPage({
  name: "cluster",
  address: {
    write: ({ label }) => "#group=" + encodeURIComponent(label),
    keys: ["group", "groupe"],                   // liens anglais, et anciens liens français
    read: label => { const c = S.clusters.find(x => x.label === label); return c ? { id: c.id, label: c.label } : null; },
  },
  backLabel: ({ label }) => { const c = S.clusters.find(x => x.label === label); return `Back to the group “${c ? groupName(c) : label}”`; },
  step: ({ label }) => ({ kind: "cluster", key: label }),
  fromStep: { kind: "cluster", page: key => { const c = S.clusters.find(x => x.label === key); return c ? { id: c.id, label: c.label } : null; } },
  render: args => {
    const c = groupOfArgs(args);
    if (!c) return { html: "" };
    S.cluster = c;
    const members = S.docs.filter(d => d.cluster === c.id);
    // les textes du cœur du groupe d'abord
    const dist = d => (d.x - c.x) ** 2 + (d.y - c.y) ** 2;
    members.sort((a, b) => dist(a) - dist(b));
    const visible = members.filter(d => !isHidden(d));
    const keywords = c.keywords && c.keywords !== c.label
      ? `<p class="keywords"><span>Keywords</span> ${esc(c.keywords)}</p>` : "";
    return {
      html: `<article class="card">
    <div class="cat">Group of texts</div>
    <h2>${esc(groupName(c))}</h2>
    ${groupDesc(c) ? `<p class="text">${esc(groupDesc(c))}</p>` : ""}
    <p class="count">${c.n} texts${visible.length < members.length ? `, ${visible.length} of them shown` : ""}.</p>
    ${keywords}
    <ol class="results">${visible.map(d => docRow(d, esc(nameOf(d)), esc(snippet(textOf(d), [])))).join("")}</ol>
  </article>`,
      bind: panel => panel.querySelectorAll("button[data-i]").forEach(b =>
        b.addEventListener("click", () => select(+b.dataset.i))),
      announce: `Group ${groupName(c)}: ${c.n} texts`,
      frame: members,               // les étoiles du groupe à l'écran, avec le texte d'où l'on vient
    };
  },
});
