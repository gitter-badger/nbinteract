"""
Copied from ds8/textbook.

This script takes the .ipynb files in the notebooks/ folder and removes the
hidden cells as well as the newlines before closing </div> tags so that the
resulting HTML partial can be embedded in a Gitbook page easily.

For reference:
https://nbconvert.readthedocs.org/en/latest/nbconvert_library.html
http://nbconvert.readthedocs.org/en/latest/nbconvert_library.html#using-different-preprocessors
"""

import glob
import re
import os

import bs4
import nbformat
from nbconvert import HTMLExporter
from traitlets.config import Config

wrapper = """
<div id="ipython-notebook">
    <div class="buttons">
        <a class="interact-button" id="nbinteract" href="#">Run Widgets</a>
    </div>
    {html}
</div>
"""

# Use ExtractOutputPreprocessor to extract the images to separate files
config = Config()
config.HTMLExporter.preprocessors = [
    'nbconvert.preprocessors.ExtractOutputPreprocessor',
]

# Output a HTML partial, not a complete page
html_exporter = HTMLExporter(config=config)
html_exporter.template_file = 'basic'

INPUT_NOTEBOOKS = 'textbook/*.ipynb'

# Output notebook HTML partials into this directory
NOTEBOOK_HTML_DIR = 'notebooks-html'

# Output notebook HTML images into this directory
NOTEBOOK_IMAGE_DIR = 'notebooks-images'

# The prefix for each notebook + its dependencies
PATH_PREFIX = 'path=notebooks/{}'

# The regex used to find file dependencies for notebooks. I could have used
# triple quotes here but it messes up Python syntax highlighting :(
DATASET_REGEX = re.compile(
    r"read_table\("  # We look for a line containing read_table(
    r"('|\")"  # Then either a single or double quote
    r"(?P<dataset>"  # Start our named match -- dataset
    r"    (?!https?://)"  # Don't match http(s) since those aren't local files
    r"    \w+.csv\w*"  # It has to have .csv in there (might end in .gz)
    r")"  # Finish our match
    r"\1\)"  # Make sure the quotes match
    ,
    re.VERBOSE)

# Used to ensure all the closing div tags are on the same line for Markdown to
# parse them properly
CLOSING_DIV_REGEX = re.compile('\s+</div>')


def convert_notebooks_to_html_partial(notebook_paths):
    """
    Converts notebooks in notebook_paths to HTML partials in NOTEBOOK_HTML_DIR
    """
    for notebook_path in notebook_paths:
        # Computes <name>.ipynb from notebooks/<name>.ipynb
        filename = notebook_path.split('/')[-1]
        # Computes <name> from <name>.ipynb
        basename = filename.split('.')[0]
        # Computes <name>.html from notebooks/<name>.ipynb
        outfile_name = basename + '.html'

        # This results in images like AB_5_1.png for a notebook called AB.ipynb
        unique_image_key = basename
        # This sets the img tag URL in the rendered HTML. This restricts the
        # the chapter markdown files to be one level deep. It isn't ideal, but
        # the only way around it is to buy a domain for the staging textbook as
        # well and we'd rather not have to do that.
        output_files_dir = '/' + NOTEBOOK_IMAGE_DIR

        extract_output_config = {
            'unique_key': unique_image_key,
            'output_files_dir': output_files_dir,
        }

        notebook = nbformat.read(notebook_path, 4)
        raw_html, resources = html_exporter.from_notebook_node(
            notebook, resources=extract_output_config)

        html = _extract_cells(raw_html)

        with_wrapper = wrapper.format(html=html, )

        # Remove newlines before closing div tags
        final_output = CLOSING_DIV_REGEX.sub('</div>', with_wrapper)

        # Write out HTML
        outfile_path = os.path.join(os.curdir, NOTEBOOK_HTML_DIR, outfile_name)
        with open(outfile_path, 'w') as outfile:
            outfile.write(final_output)

        # Write out images
        for relative_path, image_data in resources['outputs'].items():
            image_name = relative_path.split('/')[-1]
            final_image_path = '{}/{}'.format(NOTEBOOK_IMAGE_DIR, image_name)
            with open(final_image_path, 'wb') as outimage:
                outimage.write(image_data)
        print(outfile_path + " written.")


def _extract_cells(html):
    """Return a html partial of divs with cell contents."""
    doc = bs4.BeautifulSoup(html, 'html5lib')

    divs = doc.find_all('div', class_='cell')
    for div in divs:
        if '# HIDDEN' in str(div):
            div['class'].append('hidden')

    def remove_empty_spans_and_prompts(tag):
        # We also used to decompose these tags:
        #
        # tag.find_all('span', text='None')
        #
        # But this caused issues when None actually appeared in code eg.
        # hello(None) so we removed it.
        #
        # TODO(sam): Figure out a better way to remove empty cell outputs
        for t in tag.find_all('div', class_='prompt'):
            t.decompose()

    [remove_empty_spans_and_prompts(div) for div in divs]

    return '\n'.join(map(str, divs))


if __name__ == '__main__':
    notebook_paths = glob.glob(INPUT_NOTEBOOKS)
    os.makedirs(NOTEBOOK_HTML_DIR, exist_ok=True)
    os.makedirs(NOTEBOOK_IMAGE_DIR, exist_ok=True)
    convert_notebooks_to_html_partial(notebook_paths)
