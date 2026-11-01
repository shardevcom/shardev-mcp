export default function InputError({ message }: { message?: string }) {
    return message ? (
        <p role="alert" className="text-sm text-destructive">
            {message}
        </p>
    ) : null;
}
