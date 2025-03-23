import { NextResponse } from 'next/server';
import { generateUploadUrl } from '@/lib/storage';

export async function POST(request: Request) {
  try {
    const { fileName, contentType } = await request.json();
    if (!fileName || !contentType) {
      return NextResponse.json({ error: 'Missing fileName or contentType' }, { status: 400 });
    }
    const uploadInfo = await generateUploadUrl(fileName, contentType);
    return NextResponse.json(uploadInfo);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
