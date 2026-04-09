import { notFound } from 'next/navigation';
import { getPublicBranchInfo } from '@/lib/public-registration-actions';
import JoinForm from './JoinForm';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ branch: string }>;
}

export default async function JoinPage({ params }: Props) {
  const { branch: branchId } = await params;
  const branch = await getPublicBranchInfo(branchId);

  if (!branch) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-slate-700 mb-2">유효하지 않은 QR</h1>
          <p className="text-sm text-slate-500">
            등록 지점 정보를 확인할 수 없습니다.<br />
            매장 직원에게 문의해주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8 sm:py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-medium">
          🌿 경옥채
        </div>
        <h1 className="mt-4 text-2xl sm:text-3xl font-bold text-slate-800">
          매장 회원 가입
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          <span className="font-medium text-emerald-700">{branch.name}</span>에서 가입하시면<br />
          구매 시 포인트 적립과 혜택을 받으실 수 있습니다.
        </p>
      </div>

      <JoinForm branchId={branch.id} branchName={branch.name} />

      <p className="text-center text-xs text-slate-400 mt-8">
        © 경옥채 · 본 양식은 {branch.name}에서 제공됩니다
      </p>
    </div>
  );
}
