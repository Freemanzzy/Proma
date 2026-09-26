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
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(src),str(archive)])
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

        fake=root/'incoming.app'/'Contents'/'Resources'; fake.mkdir(parents=True); (fake/'personal-build.json').write_text(json.dumps({'personal':True,'version':'0.19.58','commit':'abc','builtAt':'test'}))
        apps=root/'Applications'; apps.mkdir(); (apps/'Proma.app'/'Contents'/'Resources').mkdir(parents=True); (apps/'Proma.app'/'Contents'/'Resources'/'old.txt').write_text('old')
        data=root/'formal-data'; data.mkdir(); (data/'channels.json').write_text('{"channels":[]}')
        backups=root/'backups'
        common=['bash',str(SCRIPTS/'install-update.sh'),str(fake.parent.parent),'--apps-dir',str(apps),'--data-dir',str(data),'--backup-root',str(backups),'--test-mode','--timeout','1','--health-seconds','0']
        dry_apps=root/'dry-run-apps'; dry_args=common.copy(); dry_args[dry_args.index('--apps-dir')+1]=str(dry_apps); dry_args.append('--dry-run'); assert_run(dry_args); assert not dry_apps.exists()
        assert_run(common)
        assert (apps/'Proma.app/Contents/Resources/personal-build.json').is_file()
        marker_test=apps/'Proma.app/Contents/Resources/personal-build.json'; marker_test.write_text(json.dumps({'personal':True,'version':'0.19.58','commit':'abc','builtAt':'test'}))
        rollback_apps=root/'Applications-rollback'; rollback_apps.mkdir(); (rollback_apps/'Proma.app/Contents/Resources').mkdir(parents=True); (rollback_apps/'Proma.app/Contents/Resources/old.txt').write_text('old')
        failure_args=common.copy(); failure_args[failure_args.index('--apps-dir')+1]=str(rollback_apps); failure_args[failure_args.index('--backup-root')+1]=str(root/'backups-rollback'); failure_args.append('--simulate-health-failure')
        assert_run(failure_args,expected=4)
        assert (rollback_apps/'Proma.app/Contents/Resources/old.txt').read_text()=='old'
        assert not (rollback_apps/'Proma.previous.app').exists()
        print('INSTALL ROLLBACK PASS: prior fake app restored; temporary test artifacts only')

if __name__=='__main__': main()
