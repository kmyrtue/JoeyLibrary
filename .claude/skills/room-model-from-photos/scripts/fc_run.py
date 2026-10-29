"""Run a build script inside the FreeCAD GUI without ever showing a dialog:
freecad.exe fc_run.py  (reads FC_JOB=path/to/job.py, FC_SHOT=png path).  The job defines build() -> doc."""
import os, runpy, traceback
import FreeCAD as App, FreeCADGui as Gui
from PySide import QtCore
job, shot = os.environ['FC_JOB'], os.environ.get('FC_SHOT', '')
log = open(job + '.log', 'w')
Gui.getMainWindow().showMinimized()


def finish():
    try:
        ns = runpy.run_path(job, run_name='fc_job')
        if 'after_gui' in ns:
            ns['after_gui'](shot, log)
    except Exception:
        log.write(traceback.format_exc())
    log.write('done\n'); log.close()
    for name in list(App.listDocuments()):
        App.closeDocument(name)  # discards, never asks
    os._exit(0)


QtCore.QTimer.singleShot(1500, finish)
