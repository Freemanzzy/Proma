#!/usr/bin/env python3
"""Temporary-file integration checks for personal backup/import/install scripts."""
from __future__ import annotations
import importlib.util, json, os, shutil, sqlite3, stat, subprocess, sys, tempfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'scripts' / 'personal'
spec = importlib.util.spec_from_file_location('proma_importer', SCRIPTS / 'import-proma-backup.py')
importer = importlib.util.module_from_spec(spec); sys.modules[spec.name] = importer; spec.loader.exec_module(importer)

def assert_run(args, expected=0):
    result = subprocess.run(args, text=True, capture_output=True)
    print(result.stdout, end='')
    if result.stderr: print(result.stderr, end='', file=sys.stderr)
    if result.returncode != expected: raise AssertionError(f'{args}: rc={result.returncode}, expected={expected}')
    return result

def main():
    with tempfile.TemporaryDirectory(prefix='proma-personal-script-tests-', dir='/tmp') as td:
        root=Path(td); src=root/'source'; src.mkdir(); (src/'sub').mkdir()
        (src/'alpha.txt').write_text('alpha\n'); (src/'sub'/'db.sqlite').write_bytes(b'SQLite fixture bytes')
        (src/'alpha.txt').chmod(0o640); (src/'shortcut').symlink_to('alpha.txt')
        (src/'.DS_Store').write_bytes(b'finder metadata'); (src/'session.lock').write_text('lock')
        (src/'__MACOSX').mkdir(); (src/'__MACOSX'/'._alpha.txt').write_bytes(b'resource fork')
        copied=root/'copy'; shutil.copytree(src,copied,symlinks=True)
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(src),str(copied)])
        archive=root/'backup.zip'
        with zipfile.ZipFile(archive,'w') as z:
            folder=zipfile.ZipInfo('sub/'); folder.create_system=3; folder.external_attr=(stat.S_IFDIR|0o755)<<16; z.writestr(folder,b'')
            for p in [src/'alpha.txt',src/'sub'/'db.sqlite',src/'shortcut']:
                name=p.relative_to(src).as_posix(); info=zipfile.ZipInfo(name)
                if p.is_symlink(): info.create_system=3; info.external_attr=(stat.S_IFLNK|0o777)<<16; data=os.readlink(p).encode()
                else: info.create_system=3; info.external_attr=(stat.S_IFREG|stat.S_IMODE(p.stat().st_mode))<<16; data=p.read_bytes()
                z.writestr(info,data)
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(src),str(archive),'--preset','proma-backup'])
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(src),str(copied),'--preset','proma-backup'])
        (src/'alpha.txt').write_text('changed')
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(src),str(copied)],expected=1)

        target=root/'target'; big=bytearray(b'x'*(50*1024*1024+1)); marker=os.fsencode(str(Path.home())+'/.proma/big'); big[1024*1024-5:1024*1024-5+len(marker)]=marker
        nonutf=os.fsencode(str(Path.home())+'/.proma/nonutf')+b'\xff\xfe'
        dbfile=root/'planning.db'; con=sqlite3.connect(dbfile); con.execute('create table paths(value text)'); con.execute('insert into paths values (?)',(str(Path.home())+'/.proma/db',)); con.commit(); con.close()
        zpath=root/'import.zip'
        with zipfile.ZipFile(zpath,'w',compression=zipfile.ZIP_STORED) as z:
            z.writestr('automations.json',json.dumps({'automations':[]})); z.writestr('feishu.json',json.dumps({'bots':[]})); z.writestr('wechat.json',json.dumps({'enabled':False})); z.writestr('settings.json','{}')
            zi=zipfile.ZipInfo('huge.txt'); zi.external_attr=(stat.S_IFREG|0o644)<<16; z.writestr(zi,bytes(big))
            z.writestr('binary.txt',nonutf)
            li=zipfile.ZipInfo('linked'); li.create_system=3; li.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(li,'huge.txt')
            z.write(dbfile,'planning.db')
        stats=importer.import_backup(zpath,target,False,False)
        assert stats['skipped_over_50mb']==0 and stats['skipped_non_utf8']==0,stats
        assert stats['path_replacements']>=3,stats
        assert (target/'linked').is_symlink() and os.readlink(target/'linked')=='huge.txt'
        expected=str(target).encode()
        assert expected+b'/big' in (target/'huge.txt').read_bytes()
        assert expected+b'/nonutf\xff\xfe' == (target/'binary.txt').read_bytes()
        con=sqlite3.connect(target/'planning.db'); value=con.execute('select value from paths').fetchone()[0]; con.close(); assert value==str(target)+'/db',value
        assert importer.verify_target(target)==0
        print(f'IMPORT PASS large={target.joinpath("huge.txt").stat().st_size}B non_utf8=rewritten symlink=preserved sqlite=rewritten replacements={stats["path_replacements"]}')

        health_data=root/'health-data'; health_data.mkdir()
        (health_data/'channels.json').write_text(json.dumps({'version':7,'channels':[{'id':'c1','name':'Sample','provider':'test','enabled':True,'apiKey':'secret-value'}]}))
        (health_data/'agent-sessions.json').write_text(json.dumps({'version':3,'sessions':[{'id':'session-secret-id'}]}))
        (health_data/'automations.json').write_text(json.dumps({'version':2,'automations':[{'id':'task-1','active':False,'prompt':'secret-prompt'}]}))
        (health_data/'settings.json').write_text('{}')
        health_db=sqlite3.connect(health_data/'planning.db'); health_db.execute('PRAGMA user_version=7'); health_db.close()
        (health_data/'link-target').write_text('target'); (health_data/'skill-link').symlink_to('link-target')
        health_before=root/'health-before.json'; health_after=root/'health-after.json'
        assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),str(health_data),'--output',str(health_before)])
        snap=json.loads(health_before.read_text()); snap_text=health_before.read_text()
        assert snap['versions']['channels.json']==7 and snap['sessions']['count']==1 and snap['automations']['by_id']=={'task-1':{'active':False}}
        assert snap['channels']['by_id']['c1']=={'name':'Sample','provider':'test','enabled':True} and snap['symlinks']==1 and snap['planning_user_version']==7
        assert 'secret-value' not in snap_text and 'secret-prompt' not in snap_text and 'session-secret-id' not in snap_text
        assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),str(health_data),'--output',str(health_after)])
        assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),'--compare',str(health_before),str(health_after)])

        incoming=root/'incoming.app'; resources=incoming/'Contents'/'Resources'; resources.mkdir(parents=True)
        marker={'personal':True,'version':'0.19.58','commit':'abc','builtAt':'test'}
        (resources/'personal-build.json').write_text(json.dumps(marker))
        def make_data(path):
            path.mkdir()
            (path/'channels.json').write_text(json.dumps({'version':7,'channels':[]}))
            (path/'agent-sessions.json').write_text(json.dumps({'version':3,'sessions':[]}))
            (path/'automations.json').write_text(json.dumps({'version':2,'automations':[]}))
            (path/'settings.json').write_text('{}')
            db=sqlite3.connect(path/'planning.db'); db.execute('PRAGMA user_version=7'); db.close()
            (path/'link-target').write_text('x'); (path/'skill-link').symlink_to('link-target')
        def make_apps(path):
            path.mkdir(); old=path/'Proma.app'/'Contents'/'Resources'; old.mkdir(parents=True); (old/'old.txt').write_text('old')
        data=root/'formal-data'; make_data(data)
        apps=root/'Applications'; make_apps(apps)
        backups=root/'backups'
        common=['bash',str(SCRIPTS/'install-update.sh'),str(incoming),'--apps-dir',str(apps),'--data-dir',str(data),'--backup-root',str(backups),'--test-mode','--timeout','1','--health-seconds','0']
        dry_apps=root/'dry-run-apps'; dry_args=common.copy(); dry_args[dry_args.index('--apps-dir')+1]=str(dry_apps); dry_args.append('--dry-run'); assert_run(dry_args); assert not dry_apps.exists()
        assert_run(common)
        assert (apps/'Proma.app/Contents/Resources/personal-build.json').is_file()
        assert (apps/'Proma.previous.app/Contents/Resources/old.txt').read_text()=='old'
        assert not list(apps.glob('.Proma.installing-*.app'))
        backup_dirs=sorted(p for p in backups.iterdir() if p.is_dir() and p.name[0].isdigit())
        assert len(backup_dirs)==1
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(data),str(backup_dirs[0]/'proma')])
        assert not (backup_dirs[0]/'proma'/'.personal-migration').exists()
        assert (backup_dirs[0]/'health-snapshot-before.json').is_file() and (backup_dirs[0]/'health-snapshot-after.json').is_file()

        rollback_apps=root/'Applications-rollback'; make_apps(rollback_apps)
        failure_args=common.copy(); failure_args[failure_args.index('--apps-dir')+1]=str(rollback_apps); failure_args[failure_args.index('--backup-root')+1]=str(root/'backups-rollback'); failure_args.append('--simulate-health-failure')
        assert_run(failure_args,expected=4)
        assert (rollback_apps/'Proma.app/Contents/Resources/old.txt').read_text()=='old'
        assert not (rollback_apps/'Proma.previous.app').exists()
        assert len(list(rollback_apps.glob('Proma.failed-*.app')))==1
        assert not list(rollback_apps.glob('.Proma.installing-*.app'))
        print('INSTALL HEALTH-FAILURE ROLLBACK PASS: previous fake app restored; failed bundle retained')

        copy_apps=root/'Applications-copy-fail'; make_apps(copy_apps)
        copy_args=common.copy(); copy_args[copy_args.index('--apps-dir')+1]=str(copy_apps); copy_args[copy_args.index('--backup-root')+1]=str(root/'backups-copy-fail'); copy_args.append('--simulate-copy-failure')
        assert_run(copy_args,expected=7)
        assert (copy_apps/'Proma.app/Contents/Resources/old.txt').read_text()=='old'
        assert not (copy_apps/'Proma.previous.app').exists() and not list(copy_apps.glob('.Proma.installing-*.app'))
        assert not list(copy_apps.glob('Proma.failed-*.app'))
        print('INSTALL COPY-FAILURE RECOVERY PASS: original app never moved; partial staging removed')

if __name__=='__main__': main()
