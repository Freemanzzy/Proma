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

def check_draft_compare(data_dir: Path, sessions_before: list[dict], sessions_after: list[dict], backups: list[tuple[str, dict]], enabled: bool = True, expected: int = 0):
    data_dir.mkdir(parents=True, exist_ok=True)
    backup_dir=data_dir/'backups'; backup_dir.mkdir(exist_ok=True)
    for p in backup_dir.iterdir():
        if p.is_file(): p.unlink()
    def snap(ids): return {'schema':1,'versions':{},'sessions':{'count':len(ids),'ids':ids},'automations':{'count':0,'by_id':{}},'channels':{'count':0,'by_id':{}},'symlinks':0,'planning_user_version':7,'errors':[]}
    before=data_dir/'before.json'; after=data_dir/'after.json'
    before.write_text(json.dumps(snap([s['id'] for s in sessions_before])))
    after.write_text(json.dumps(snap([s['id'] for s in sessions_after])))
    for filename,payload in backups: (backup_dir/filename).write_text(json.dumps(payload))
    args=['python3',str(SCRIPTS/'health-snapshot.py'),'--compare',str(before),str(after)]
    if enabled: args += ['--allow-draft-cleanup-dir',str(backup_dir),'--since','1000']
    return assert_run(args,expected=expected)

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

        zip_src=root/'zip-utf8-source'; zip_src.mkdir()
        (zip_src/'报告-测试.md').write_text('报告内容\n'); (zip_src/'alpha.txt').write_text('alpha\n')
        (zip_src/'shortcut').symlink_to('alpha.txt')
        zip_archive=root/'zip-utf8-backup.zip'
        subprocess.run(['/usr/bin/zip','-r','-y','-q',str(zip_archive),'.'],cwd=zip_src,check=True)
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(zip_src),str(zip_archive)])
        (zip_src/'报告-测试.md').write_text('篡改内容\n')
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(zip_src),str(zip_archive)],expected=1)
        print('ZIP UTF-8 FILENAME PASS: macOS zip (no 0x800 flag) filenames verified without false MISSING/EXTRA')

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
        assert 'secret-value' not in snap_text and 'secret-prompt' not in snap_text and snap['sessions']['ids']==['session-secret-id']
        assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),str(health_data),'--output',str(health_after)])
        assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),'--compare',str(health_before),str(health_after)])
        draft={'id':'draft-1','isDraft':True}; ordinary={'id':'ordinary-1','isDraft':False}
        check_draft_compare(root/'compare-no-delete',[draft],[draft],[])
        check_draft_compare(root/'compare-valid',[draft],[],[('draft-cleanup-2026-10-08T20-00-00-000Z.json',{'sessions':[draft]})])
        check_draft_compare(root/'compare-unbacked',[draft],[],[],expected=1)
        check_draft_compare(root/'compare-nondraft',[ordinary],[],[('draft-cleanup-2026-10-08T20-00-00-000Z.json',{'sessions':[ordinary]})],expected=1)
        old_dir=root/'compare-old'; old_dir.mkdir(); old_backup=old_dir/'backups'; old_backup.mkdir()
        old_before=old_dir/'before.json'; old_after=old_dir/'after.json'
        old_before.write_text(json.dumps({'schema':1,'sessions':{'count':1,'ids':['draft-1']},'versions':{},'automations':{'count':0,'by_id':{}},'channels':{'count':0,'by_id':{}},'symlinks':0,'planning_user_version':7,'errors':[]}))
        old_after.write_text(json.dumps({'schema':1,'sessions':{'count':0,'ids':[]},'versions':{},'automations':{'count':0,'by_id':{}},'channels':{'count':0,'by_id':{}},'symlinks':0,'planning_user_version':7,'errors':[]}))
        oldfile=old_backup/'draft-cleanup-2026-10-08T00-00-00-000Z.json'; oldfile.write_text(json.dumps({'sessions':[draft]})); os.utime(oldfile,(1,1))
        assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),'--compare',str(old_before),str(old_after),'--allow-draft-cleanup-dir',str(old_backup),'--since','2000000000'],expected=1)
        filename_dir=root/'compare-filename-time'; filename_dir.mkdir(); filename_backup=filename_dir/'backups'; filename_backup.mkdir()
        filename_before=filename_dir/'before.json'; filename_after=filename_dir/'after.json'
        filename_before.write_text(json.dumps({'schema':1,'sessions':{'count':1,'ids':['draft-1']},'versions':{},'automations':{'count':0,'by_id':{}},'channels':{'count':0,'by_id':{}},'symlinks':0,'planning_user_version':7,'errors':[]}))
        filename_after.write_text(json.dumps({'schema':1,'sessions':{'count':0,'ids':[]},'versions':{},'automations':{'count':0,'by_id':{}},'channels':{'count':0,'by_id':{}},'symlinks':0,'planning_user_version':7,'errors':[]}))
        filename_file=filename_backup/'draft-cleanup-2026-10-08T20-00-00-000Z.json'; filename_file.write_text(json.dumps({'sessions':[draft]})); os.utime(filename_file,(1,1))
        assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),'--compare',str(filename_before),str(filename_after),'--allow-draft-cleanup-dir',str(filename_backup),'--since','1000'])
        check_draft_compare(root/'compare-new',[draft],[draft,{'id':'new-session','isDraft':False}],[],expected=1)
        check_draft_compare(root/'compare-disabled',[draft],[],[('draft-cleanup-2026-10-08T20-00-00-000Z.json',{'sessions':[draft]})],enabled=False,expected=1)
        legacy_dir=root/'compare-legacy-ids'; legacy_dir.mkdir()
        def legacy_snap(sessions, with_ids): return {'schema':1,'versions':{},'sessions':({'count':len(sessions),'ids':sessions} if with_ids else {'count':len(sessions)}),'automations':{'count':0,'by_id':{}},'channels':{'count':0,'by_id':{}},'symlinks':0}
        (legacy_dir/'old.json').write_text(json.dumps(legacy_snap(['a','b'],False)))
        (legacy_dir/'new.json').write_text(json.dumps(legacy_snap(['a','b'],True)))
        (legacy_dir/'new-fewer.json').write_text(json.dumps(legacy_snap(['a'],True)))
        out=assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),'--compare',str(legacy_dir/'old.json'),str(legacy_dir/'new.json')])
        assert 'legacy snapshot without sessions.ids' in out.stdout
        assert_run(['python3',str(SCRIPTS/'health-snapshot.py'),'--compare',str(legacy_dir/'old.json'),str(legacy_dir/'new-fewer.json')],expected=1)
        print('LEGACY SNAPSHOT COMPARISON PASS: missing ids compared by counts only, count change still rejected')
        print('DRAFT-CLEANUP COMPARISON PASS: no-delete, exact backup, unbacked removal, non-draft, stale backup, new ID, legacy strict mode')

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
        previous_dir=backups/'previous'
        assert (previous_dir/'Proma.app/Contents/Resources/old.txt').read_text()=='old'
        assert not (apps/'Proma.previous.app').exists()
        assert not (previous_dir/'.trash').exists()  # 首次安装：新位置此前不存在，无需移入废纸篓
        assert not list(apps.glob('.Proma.installing-*.app'))
        backup_dirs=sorted(p for p in backups.iterdir() if p.is_dir() and p.name[0].isdigit())
        assert len(backup_dirs)==1
        assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(data),str(backup_dirs[0]/'proma')])
        assert not (backup_dirs[0]/'proma'/'.personal-migration').exists()
        assert (backup_dirs[0]/'health-snapshot-before.json').is_file() and (backup_dirs[0]/'health-snapshot-after.json').is_file()
        print('INSTALL PREVIOUS-LOCATION PASS: previous app kept under backup-root/previous, not /Applications')

        # /tmp-only end-to-end simulation: real cleanup backup passes; deleting a non-draft without a backup fails and rolls back.
        sim_data=root/'sim-data'; make_data(sim_data)
        simdoc=json.loads((sim_data/'agent-sessions.json').read_text()); simdoc['sessions']=[{'id':'draft-sim','isDraft':True}]
        (sim_data/'agent-sessions.json').write_text(json.dumps(simdoc))
        sim_apps=root/'Applications-sim'; make_apps(sim_apps); sim_backups=root/'backups-sim'
        sim_args=['bash',str(SCRIPTS/'install-update.sh'),str(incoming),'--apps-dir',str(sim_apps),'--data-dir',str(sim_data),'--backup-root',str(sim_backups),'--test-mode','--timeout','1','--health-seconds','0','--simulate-draft-cleanup']
        assert_run(sim_args)
        assert json.loads((sim_data/'agent-sessions.json').read_text())['sessions']==[]
        bad_data=root/'sim-bad-data'; make_data(bad_data)
        baddoc=json.loads((bad_data/'agent-sessions.json').read_text()); baddoc['sessions']=[{'id':'ordinary-sim','isDraft':False}]
        (bad_data/'agent-sessions.json').write_text(json.dumps(baddoc))
        bad_apps=root/'Applications-sim-bad'; make_apps(bad_apps); bad_backups=root/'backups-sim-bad'
        bad_args=['bash',str(SCRIPTS/'install-update.sh'),str(incoming),'--apps-dir',str(bad_apps),'--data-dir',str(bad_data),'--backup-root',str(bad_backups),'--test-mode','--timeout','1','--health-seconds','0','--simulate-unbacked-session-removal']
        assert_run(bad_args,expected=4)
        assert (bad_apps/'Proma.app/Contents/Resources/old.txt').is_file()
        assert len(list(bad_apps.glob('Proma.failed-*.app')))==1
        print('INSTALL DRAFT SIMULATION PASS: backed draft cleanup accepted; unbacked non-draft removal rejected and app rolled back')

        # 未指定归档目录时演练模式不归档：第二次安装后本机保留 2 份。
        assert_run(common)
        backup_dirs=sorted(p for p in backups.iterdir() if p.is_dir() and p.name[0].isdigit())
        assert len(backup_dirs)==2
        # 已有 previous（上一步刚生成，内容仍是最早的 "old" 占位应用）不会被覆盖或删除：移入演练用
        # previous/.trash/；新 previous 是这次安装前的 apps/Proma.app（即第一次安装装入的 incoming 包）。
        prev_marker=json.loads((previous_dir/'Proma.app/Contents/Resources/personal-build.json').read_text())
        assert prev_marker['commit']==marker['commit']
        trash_items=sorted((previous_dir/'.trash').iterdir())
        assert len(trash_items)==1, trash_items
        assert (trash_items[0]/'Contents/Resources/old.txt').read_text()=='old'
        print('INSTALL PREVIOUS-TRASH PASS: pre-existing previous moved to previous/.trash/; new previous is the just-replaced package')
        # 指定归档目录：第三次安装后本机只留最新 1 份，其余 2 份归档且校验一致。
        archive=root/'archive'
        assert_run(common+['--archive-dir',str(archive)])
        local=sorted(p for p in backups.iterdir() if p.is_dir() and p.name[0].isdigit())
        archived=sorted(p for p in archive.iterdir() if p.is_dir())
        assert len(local)==1 and len(archived)==2, (local, archived)
        assert local[0].name > max(a.name for a in archived)
        for a in archived:
            assert (a/'proma').is_dir() and (a/'health-snapshot-before.json').is_file()
            assert_run(['python3',str(SCRIPTS/'verify-backup.py'),str(data),str(a/'proma')])
        # 归档目录不在 /tmp 时演练模式拒绝。
        assert_run(common+['--archive-dir','/Volumes/not-allowed'],expected=2)
        print('INSTALL BACKUP ARCHIVE PASS: newest kept locally; older backups archived and verified')

        # 兼容旧布局：$APPS_DIR/Proma.previous.app（旧版脚本的位置）在安装开始前会被迁移到新的
        # previous 位置；随后本次安装把当前 app 顶替进 previous 位置时，迁移进来的旧内容按常规规则
        # 被移入 .trash/（因为新位置已被占用）。
        legacy_apps=root/'Applications-legacy'; make_apps(legacy_apps)
        legacy_previous=legacy_apps/'Proma.previous.app'/'Contents'/'Resources'; legacy_previous.mkdir(parents=True)
        (legacy_previous/'legacy.txt').write_text('legacy')
        legacy_backups=root/'backups-legacy'
        legacy_args=common.copy(); legacy_args[legacy_args.index('--apps-dir')+1]=str(legacy_apps); legacy_args[legacy_args.index('--backup-root')+1]=str(legacy_backups)
        assert_run(legacy_args)
        assert not (legacy_apps/'Proma.previous.app').exists()
        legacy_previous_dir=legacy_backups/'previous'
        assert (legacy_previous_dir/'Proma.app/Contents/Resources/old.txt').read_text()=='old'
        legacy_trash_items=list((legacy_previous_dir/'.trash').iterdir())
        assert len(legacy_trash_items)==1, legacy_trash_items
        assert (legacy_trash_items[0]/'Contents/Resources/legacy.txt').read_text()=='legacy'
        print('INSTALL LEGACY-PREVIOUS MIGRATION PASS: old /Applications/Proma.previous.app migrated to backup-root/previous, then trashed on replacement')

        rollback_apps=root/'Applications-rollback'; make_apps(rollback_apps)
        rollback_backups=root/'backups-rollback'
        failure_args=common.copy(); failure_args[failure_args.index('--apps-dir')+1]=str(rollback_apps); failure_args[failure_args.index('--backup-root')+1]=str(rollback_backups); failure_args.append('--simulate-health-failure')
        assert_run(failure_args,expected=4)
        assert (rollback_apps/'Proma.app/Contents/Resources/old.txt').read_text()=='old'
        assert not (rollback_apps/'Proma.previous.app').exists()
        assert not (rollback_backups/'previous'/'Proma.app').exists()
        assert len(list(rollback_apps.glob('Proma.failed-*.app')))==1
        assert not list(rollback_apps.glob('.Proma.installing-*.app'))
        print('INSTALL HEALTH-FAILURE ROLLBACK PASS: previous fake app restored from backup-root/previous; failed bundle retained')

        copy_apps=root/'Applications-copy-fail'; make_apps(copy_apps)
        copy_backups=root/'backups-copy-fail'
        copy_args=common.copy(); copy_args[copy_args.index('--apps-dir')+1]=str(copy_apps); copy_args[copy_args.index('--backup-root')+1]=str(copy_backups); copy_args.append('--simulate-copy-failure')
        assert_run(copy_args,expected=7)
        assert (copy_apps/'Proma.app/Contents/Resources/old.txt').read_text()=='old'
        assert not (copy_apps/'Proma.previous.app').exists() and not list(copy_apps.glob('.Proma.installing-*.app'))
        assert not (copy_backups/'previous'/'Proma.app').exists()
        assert not list(copy_apps.glob('Proma.failed-*.app'))
        print('INSTALL COPY-FAILURE RECOVERY PASS: original app never moved; partial staging removed')

if __name__=='__main__': main()
