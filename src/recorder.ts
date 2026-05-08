/**
 * 音频录制页面 — 用于录制参考音频（隐藏窗口）。
 * 通过 MediaRecorder API 捕获麦克风输入。
 * 预留给后续"录制参考音"功能使用。
 */

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    chunks = []

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' })
      const url = URL.createObjectURL(blob)
      // TODO: 发送到主进程保存
      stream.getTracks().forEach(t => t.stop())
    }

    mediaRecorder.start()
  } catch (err) {
    console.error('录音启动失败:', err)
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
}

// TODO: 通过 IPC 接收录音指令
