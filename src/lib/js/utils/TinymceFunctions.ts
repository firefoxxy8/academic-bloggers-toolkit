declare const ABT_i18n: BackendGlobals.ABT_i18n;
declare const ABT_wp: BackendGlobals.ABT_wp;

/**
 * Opens `reference-window.tsx` and returns a promise which resolves to either
 *   `ABT.ReferenceWindowPayload` or `null` on close.
 * @param editor   The active TinyMCE instance.
 * @return A Promise which resolves to ABT.ReferenceWindowPayload
 */
export function referenceWindow(editor: TinyMCE.Editor): Promise<ABT.ReferenceWindowPayload> {
    return new Promise((resolve) => {
        editor.windowManager.open({
            height: 10,
            onclose: (e) => {
                if (!e.target.params.data) resolve(null);
                resolve(e.target.params.data as ABT.ReferenceWindowPayload);
            },
            params: {
                baseUrl: `${ABT_wp.abt_url}/lib/js/tinymce/views/`,
            },
            title: ABT_i18n.tinymce.referenceWindow.referenceWindow.title,
            url: `${ABT_wp.abt_url}/lib/js/tinymce/views/reference-window.html`,
            width: 600,
        });
    });
};

/**
 * Opens `import-window.tsx` and returns a promise which resolves to
 *   `CSL.Data[]` or `null` on close
 * @param  editor The active TinyMCE instance.
 * @return A Promise which resolves to CSL.Data[]
 */
export function importWindow(editor: TinyMCE.Editor): Promise<CSL.Data[]> {
    return new Promise((resolve) => {
        editor.windowManager.open({
            height: 10,
            onclose: (e) => {
                if (!e.target.params.data) resolve(null);
                resolve(e.target.params.data as CSL.Data[]);
            },
            title: ABT_i18n.tinymce.importWindow.title,
            url: `${ABT_wp.abt_url}/lib/js/tinymce/views/import-window.html`,
            width: 600,
        });
    });
}

interface CitationPositions {
    /** The index of the HTMLSpanElement being inserted */
    currentIndex: number;
    locations: [Citeproc.CitationsPrePost, Citeproc.CitationsPrePost];
}
/**
 * Iterates the active TinyMCE instance and obtains the citations that come both
 *   before and after the inline citation being inserted currently. Also receives
 *   the index of the current citation within the document (ie, if there's one
 *   citation before and one citation after the current citation, `currentIndex`
 *   will be 1).
 * @param editor The active TinyMCE instance.
 * @return Parsed citation data.
 */
export function getRelativeCitationPositions(editor: TinyMCE.Editor): CitationPositions {
    const doc: Document = editor.dom.doc;
    const currentSelection = editor.selection.getContent({ format: 'html' });
    const re = /<span id="([\d\w]+)" class="abt_cite .+<\/span>/;
    const id = (currentSelection.match(re) || ['', 'CURSOR'])[1];

    if (id === 'CURSOR') {
        editor.insertContent(
            `<span id="CURSOR" class="abt_cite"></span>`
        );
    }

    // TinyMCE creates a hidden duplicate of selections - this selector ensures
    // that we do not include that.
    const citations = doc.querySelectorAll('*:not(.mce-offscreen-selection) > .abt_cite');
    const payload: CitationPositions = {
        currentIndex: 0,
        locations: [[], []],
    };

    if (citations.length > 1) {
        let key = 0;
        Array.from(citations).forEach((el, i) => {
            if (el.id === id) {
                key = 1;
                payload.currentIndex = i;
                return;
            }
            payload.locations[key].push([el.id, i - key]);
        });
    }
    const el = editor.dom.doc.getElementById('CURSOR');
    if (el) el.parentElement.removeChild(el);
    return payload;
}

/**
 * Updates the editor with inline citation data (citation clusters) generated
 *   by the processor.
 *
 * @param  editor   Active TinyMCE editor.
 * @param  clusters Citeproc.CitationClusterData[] generated by the processor.
 * @param  citationByIndex CitationByIndex data used to generate data attributes.
 * @param  xclass   Type of citation (full-note style or in-text style).
 * @return Promise which acts as a semaphore for the bibliography parser.
 */
export function parseInlineCitations(
    editor: TinyMCE.Editor,
    clusters: Citeproc.CitationClusterData[],
    citationByIndex: Citeproc.CitationByIndex,
    xclass: 'in-text'|'note',
): Promise<boolean> {
    return xclass === 'note'
        ? parseFootnoteCitations(editor, clusters, citationByIndex)
        : parseInTextCitations(editor, clusters, citationByIndex);
}

function parseFootnoteCitations(
    editor: TinyMCE.Editor,
    clusters: Citeproc.CitationClusterData[],
    citationByIndex: Citeproc.CitationByIndex,
): Promise<boolean> {
    return new Promise(resolve => {
        const doc = editor.dom.doc;
        const exisingNote = doc.getElementById('abt-footnote');

        if (exisingNote) exisingNote.parentElement.removeChild(exisingNote);
        if (clusters.length === 0) return resolve(true);

        for (const [index, footnote, elementID] of clusters) {
            const inlineText = `[${index + 1}]`;
            const citation: HTMLSpanElement = editor.dom.doc.getElementById(elementID);
            const sortedItems: Citeproc.SortedItems = citationByIndex[index].sortedItems;
            const idList: string = JSON.stringify(sortedItems.map(c => c[1].id));

            if (!citation) {
                editor.insertContent(
                    `<span
                        id='${elementID}'
                        data-reflist='${idList}'
                        data-footnote='${footnote}'
                        class='abt_cite noselect mceNonEditable'
                    >
                        ${inlineText}
                    </span>`
                );
                continue;
            }
            citation.innerHTML = inlineText;
            citation.dataset['reflist'] = idList;
            citation.dataset['footnote'] = footnote;
        }

        const note = doc.createElement('DIV');
        note.id = 'abt-footnote';
        note.className = 'noselect mceNonEditable';

        const heading = doc.createElement('DIV');
        heading.className = 'abt-footnote-heading';
        heading.innerText = 'Footnotes';
        note.appendChild(heading);

        const citations = doc.getElementsByClassName('abt_cite') as HTMLCollectionOf<HTMLSpanElement>;

        for (let i = 0; i < citations.length; i++) {
            // Adjust the number of the inline footnote
            citations[i].innerText = `[${i + 1}]`;

            /**
             * Iterate and set a new footnote box using stored html on the inline notes.
             * "Isn't this really inefficient?". Yes. It's citeproc-js's fault.
             */
            const div = doc.createElement('DIV');
            div.className = 'abt-footnote-item';
            div.innerHTML =
                `<span class="note-number">[${i + 1}]</span>` +
                `<span class="note-item">${citations[i].dataset['footnote']}</span>`;
            note.appendChild(div);
        }

        const bib = doc.getElementById('abt-smart-bib');

        // Save a reference to the current cursor location
        const selection = editor.selection;
        const cursor = editor.dom.create('span', { class: 'abt_cite', id: 'CURSOR' });
        selection.getNode().appendChild(cursor);

        // Do work
        if (bib) bib.parentNode.removeChild(bib);

        editor.setContent(editor.getContent() + note.outerHTML);

        // Move cursor back to where it was & delete reference
        const el = doc.getElementById('CURSOR');
        if (el) {
            editor.selection.select(el, true);
            editor.selection.collapse(true);
            el.parentElement.removeChild(el);
        }
        resolve(true);
    });
}

function parseInTextCitations(
    editor: TinyMCE.Editor,
    clusters: Citeproc.CitationClusterData[],
    citationByIndex: Citeproc.CitationByIndex,
): Promise<boolean> {
    return new Promise(resolve => {
        const doc = editor.dom.doc;
        const exisingNote = doc.getElementById('abt-footnote');
        if (exisingNote) exisingNote.parentElement.removeChild(exisingNote);

        for (const [index, inlineText, elementID] of clusters) {
            const citation: HTMLSpanElement = editor.dom.doc.getElementById(elementID);
            const sortedItems: Citeproc.SortedItems = citationByIndex[index].sortedItems;
            const idList: string = JSON.stringify(sortedItems.map(c => c[1].id));

            if (!citation) {
                editor.insertContent(
                    `<span
                        id='${elementID}'
                        data-reflist='${idList}'
                        class='abt_cite noselect mceNonEditable'
                    >
                        ${inlineText}
                    </span>`
                );
                continue;
            }
            citation.innerHTML = inlineText;
            citation.dataset['reflist'] = idList;
        }
        resolve(true);
    });
}

/**
 * Replaces the current bibliography, or creates a new one if one doesn't exist
 * @param editor       Active TinyMCE editor.
 * @param bibliography Bibliography array or `false` if current style doesn't
 *                                    produce a bibliography.
 * @param options      Bibliography options
 */
export function setBibliography(
    editor: TinyMCE.Editor,
    bibliography: ABT.Bibliography|boolean,
    options: {heading: string, style: 'fixed'|'toggle'}
): void {
    const doc = editor.dom.doc;
    const existingBib = doc.getElementById('abt-smart-bib');

    if (typeof bibliography === 'boolean') {
        if (existingBib) existingBib.parentElement.removeChild(existingBib);
        return;
    }

    const bib = doc.createElement('DIV');
    bib.id = 'abt-smart-bib';
    bib.className = 'noselect mceNonEditable';

    if (options.heading) {
        const heading = doc.createElement('H3');
        heading.innerText = options.heading;
        if (options.style === 'toggle') heading.className = 'toggle';
        bib.appendChild(heading);
    }

    for (const meta of bibliography) {
        const item = doc.createElement('DIV');
        item.id = meta.id;
        item.innerHTML = meta.html;
        bib.appendChild(item);
    }

    const noCitationsWithHeading: boolean =
        bib.children.length === 1
        && options.heading !== null
        && options.heading !== '';
    const noCitationsWithoutHeading: boolean = bib.children.length === 0;

    if (existingBib) existingBib.parentElement.removeChild(existingBib);
    if (noCitationsWithHeading || noCitationsWithoutHeading) return;

    // Save a reference to the current cursor location
    const selection = editor.selection;
    const cursor = editor.dom.create('span', { class: 'abt_cite', id: 'CURSOR' });
    selection.getNode().appendChild(cursor);

    // Do work
    editor.setContent(editor.getContent() + bib.outerHTML);

    // Move cursor back to where it was & delete reference
    const el = editor.dom.doc.getElementById('CURSOR');
    if (el) {
        editor.selection.select(el, true);
        editor.selection.collapse(true);
        el.parentElement.removeChild(el);
    }

    // Remove unnecessary &nbsp; from editor
    const p = editor.dom.doc.getElementById('abt-smart-bib').previousElementSibling;
    if (p.tagName === 'P' && p.textContent.trim() === '') {
        p.parentNode.removeChild(p);
    }
}

export function reset(doc: HTMLDocument) {
    const inlines = doc.querySelectorAll('.abt_cite');
    const bib = doc.querySelector('#abt-smart-bib');
    for (const cite of inlines) {
        cite.parentNode.removeChild(cite);
    }
    if (bib) bib.parentNode.removeChild(bib);
}
