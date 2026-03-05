name: jupyter
description: Create a Jupyter notebook for FABRIC experiments
---
Create a Jupyter notebook (.ipynb) for FABRIC experiments.

1. **Understand the goal**: What experiment or analysis? What should the notebook demonstrate?

2. **Create the notebook** with:
   - Title and description in a markdown cell
   - Import cells (FABlib, pandas, matplotlib, etc.)
   - Step-by-step cells with markdown explanations
   - Code cells for slice creation, data collection, analysis
   - Cleanup cell at the end (delete slice)

3. **Notebook JSON structure** (.ipynb format):
   ```json
   {
     "cells": [
       {
         "cell_type": "markdown",
         "metadata": {},
         "source": ["# Title\n", "Description"]
       },
       {
         "cell_type": "code",
         "metadata": {},
         "source": ["import fablib\n", "..."],
         "execution_count": null,
         "outputs": []
       }
     ],
     "metadata": {
       "kernelspec": {
         "display_name": "Python 3",
         "language": "python",
         "name": "python3"
       },
       "language_info": {
         "name": "python",
         "version": "3.11.0"
       }
     },
     "nbformat": 4,
     "nbformat_minor": 5
   }
   ```

4. **Save** to the working directory or specified path.
