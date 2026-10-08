-- 운영자 전용: Supabase SQL Editor에서 실행합니다.
-- 이 파일을 브라우저에 연결하거나 클라이언트 RPC로 만들지 마세요.
-- 계정 생성·이메일 인증을 완료한 팀원의 이메일만 넣으세요.
-- 먼저 해당 인원이 실제 팀원인지 확인합니다. 비밀번호는 필요하지 않습니다.

begin;
do $$
declare
  member_email text := 'REPLACE_WITH_VERIFIED_TEAM_EMAIL';
  target_id uuid;
  verified_at timestamptz;
begin
  if member_email = 'REPLACE_WITH_VERIFIED_TEAM_EMAIL' then
    raise exception '승인할 팀원의 실제 가입 이메일을 입력하세요.';
  end if;
  select id, email_confirmed_at into target_id, verified_at
  from auth.users
  where lower(email) = lower(trim(member_email));
  if target_id is null then
    raise exception '가입된 사용자를 찾지 못했습니다. 먼저 대시보드에서 계정을 생성하세요.';
  end if;
  if verified_at is null then
    raise exception '이메일 인증이 완료되지 않았습니다.';
  end if;
  insert into public.dashboard_access(user_id, active)
  values(target_id, true)
  on conflict (user_id) do update set active=true, granted_at=now();
end;
$$;
commit;

-- 승인 취소가 필요할 때만 아래 쿼리의 이메일을 바꾸고 실행하세요.
-- update public.dashboard_access set active=false
-- where user_id in (select id from auth.users where lower(email)=lower('TEAM_EMAIL'));
-- 승인 취소 후 DB 접근은 즉시 거부됩니다. 화면도 다음 권한 조회 시 초기 계획으로 되돌아갑니다.
